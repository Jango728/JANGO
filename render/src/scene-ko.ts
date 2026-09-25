import * as T from "three";
import type { Actor } from "./characters";
import type { Arena } from "./arena";
import {
  V, at, bell, punchIK, clamp, clip, clonePose, easeIn, easeOut, easeInOut, lerpV, legTo, armTo, loop, noise1, pingpong, place, pose, rotatePose, seg, shift, smooth, speed, toWorld, yawTo, applyShots, blendJoints,
  UPPER, HEADSET, type Shot, type Clip,
} from "./director";
import { lerpPose, type Pose } from "./rig";
import { makeSpray, timeWarp } from "./fx";

export type Ctx = { W: Actor; L: Actor; ref: Actor; arena: Arena; cam: T.PerspectiveCamera; grade: { uniforms: Record<string, { value: number }> }; scene: T.Scene };

export const FIGHT_YAW = Math.atan2(0.36, 0.43);

/* ---------- shared pieces used by all three finishes ---------- */
export async function commonClips() {
  return {
    stance: await clip("dataset-1_punch_normal_001", { yaw: FIGHT_YAW, trend: false }),
    punch: await clip("dataset-1_punch_normal_002", { yaw: FIGHT_YAW, trend: false }),
    swag: await clip("dataset-1_walk_chimpira_001"),
    runSwag: await clip("dataset-1_run_chimpira_001"),
    runRef: await clip("dataset-2_run_masculine_001"),
    wave: await clip("dataset-2_wave-both-hands_active_001", { trend: false }),
    neutral: await clip("dataset-2_raise-up-both-hands_masculine_001", { trend: false }),
  };
}
export type Clips = Awaited<ReturnType<typeof commonClips>>;

/** fighter's bouncing stance, with a per-fighter phase */
export function stancePose(c: Clips, t: number, phase: number) {
  return pingpong(c.stance, t + phase, 0.12, 0.8, 0.68);
}
/** referee standing, weight shifting */
export function refIdle(c: Clips, t: number) {
  const p = at(c.neutral, 0.05);
  const sway = noise1(t * 0.6, 9) * 0.03;
  return shift(p, V(sway, 0, 0), UPPER);
}

/** A limp standing pose derived from p: arms hang, head drops. */
export function limp(p: Pose, w: number) {
  let o = clonePose(p);
  for (const s of ["l", "r"] as const) {
    const sh = o[`${s}Sh`], out = s === "l" ? 1 : -1;
    const el = sh.clone().add(V(0.05 * out, -0.27, 0.03));
    const wr = el.clone().add(V(0.03 * out, -0.25, 0.07));
    o[`${s}El`].lerp(el, w);
    o[`${s}Wr`].lerp(wr, w);
  }
  return o;
}

/** Backward timber fall: rotate about the ankle axis, body lands on its back. */
export function fallPose(base: Pose, theta: number, knee: number) {
  // buckle: lower the hips and push knees forward, keeping the ankles planted
  let p = shift(base, V(0, -0.14 * knee, -0.03 * knee), ["hips", "spine", "chest", "neck", "head", "lClav", "rClav", "lSh", "rSh", "lEl", "rEl", "lWr", "rWr", "lHip", "rHip"]);
  p = legTo(p, "l", p.lAn.clone(), p.lAn.clone().add(V(0, 0.3, 1)));
  p = legTo(p, "r", p.rAn.clone(), p.rAn.clone().add(V(0, 0.3, 1)));
  const pivot = p.lAn.clone().add(p.rAn).multiplyScalar(0.5);
  return rotatePose(p, pivot, V(1, 0, 0), -theta);
}

/** Final lying-on-back pose (actor space: feet near origin, head toward −Z). */
export function lyingPose(base: Pose, fence: number, armDrop: number) {
  let p = fallPose(limp(base, 1), Math.PI / 2 - 0.04, 0);
  // settle everything onto the canvas: joint centres ~0.11 m above the mat
  const minY = Math.min(p.hips.y, p.chest.y, p.spine.y);
  p = shift(p, V(0, 0.115 - minY, 0));
  // knees up a little, legs apart
  p = legTo(p, "l", p.lAn.clone().add(V(0.08, 0, -0.12)), p.lKn.clone().add(V(0.1, 0.6, 0)));
  p = legTo(p, "r", p.rAn.clone().add(V(-0.1, 0, -0.05)), p.rKn.clone().add(V(-0.1, 0.4, 0)));
  // head rolls to one side
  p.head.add(V(0.07, -0.04, 0));
  // left arm flung out on the mat
  p = armTo(p, "l", p.lSh.clone().add(V(0.5, -0.07, -0.12)), p.lSh.clone().add(V(0.3, 0.2, 0.3)));
  // right arm: fencing response (forearm locked straight up), then drops
  const sh = p.rSh.clone();
  const elUp = sh.clone().add(V(-0.24, -0.02, 0.12));
  const wrUp = elUp.clone().add(V(-0.02, 0.26, -0.04));
  const elDn = sh.clone().add(V(-0.25, -0.06, 0.12));
  const wrDn = elDn.clone().add(V(-0.12, -0.02, 0.22));
  const f = fence * (1 - armDrop);
  p.rEl.copy(elDn.clone().lerp(elUp, f));
  p.rWr.copy(wrDn.clone().lerp(wrUp, f));
  return p;
}

/** run around a centre point on a circle; returns root position/yaw and a leaning run pose */
export function circleRun(c: Clip, t: number, centre: T.Vector3, R: number, a0: number, dirSign: number, rate: number) {
  const v = speed(c) * rate;
  const a = a0 + (dirSign * v * t) / R;
  const pos = centre.clone().add(V(Math.cos(a) * R, 0, Math.sin(a) * R));
  const vel = V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(dirSign);
  const yaw = Math.atan2(vel.x, vel.z);
  let p = loop(c, t * rate, 0.35, c.mc.duration - 0.2, 0.25);
  // lean into the turn (toward the centre)
  const lean = dirSign * 0.16;
  p = rotatePose(p, V(0, 0, 0), V(0, 0, 1), lean);
  return { pos, yaw, pose: p };
}

/* ======================================================================
 * KNOCKOUT
 * ====================================================================== */
export async function koScript(ctx: Ctx) {
  const { W, L, ref, cam, grade, arena, scene } = ctx;
  const c = await commonClips();
  const spray = makeSpray(scene);
  const warp = timeWarp([{ from: 3.3, to: 4.25, rate: 0.28, ramp: 0.12 }], 12);
  const IMPACT = 3.5;
  const DURATION = 8.6; // film seconds (ends on the double-bird insert)

  // layout during the exchange: W on −x, L on +x
  const C = V(0.1, 0, 0.25);
  const lineAt = (s: number) => {
    const phi = -0.95 + 0.95 * smooth(seg(s, 0, 2.2)) + noise1(s * 0.4, 7) * 0.05;
    const d = 2.4 - 1.35 * smooth(seg(s, 0.2, 2.2));
    const dir = V(Math.cos(phi), 0, Math.sin(phi));
    return { dir, d, phi };
  };
  // loser's final spot (frozen once he is hit)
  const lHit = (() => {
    const { dir, d } = lineAt(IMPACT);
    return { pos: C.clone().addScaledVector(dir, d / 2), yaw: yawTo(C.clone().addScaledVector(dir, d / 2), C.clone().addScaledVector(dir, -d / 2)) };
  })();
  // L lies with his head toward his local −Z
  place(L, lHit.pos, lHit.yaw);
  pose(L, lyingPose(stancePose(c, IMPACT, 0.9), 0, 1));
  const lChest = L.rig.pos("spine2").setY(0);
  const lHead = L.rig.pos("head").setY(0);
  const birdSpot = lChest.clone().add(toWorld(V(), lHit.yaw, V(-0.68, 0, 0.42)));
  const refSpot = lHead.clone().add(toWorld(V(), lHit.yaw, V(0.08, 0, -0.62)));
  const refStart = V(0.9, 0, -2.5);

  // W position through the exchange (with the lunge on the hook)
  const wAt = (s: number) => {
    const { dir, d } = lineAt(Math.min(s, IMPACT));
    const lunge = 0.24 * smooth(seg(s, 3.1, 3.48)) - 0.12 * smooth(seg(s, 3.7, 4.3));
    const pos = C.clone().addScaledVector(dir, -d / 2 + lunge);
    return { pos, yaw: yawTo(pos, C.clone().addScaledVector(dir, d / 2)) };
  };
  const walkStart = 4.45, walkRate = 1.35;
  const walkFrom = wAt(walkStart).pos;
  const walkLen = walkFrom.distanceTo(birdSpot);
  const walkDur = walkLen / (speed(c.swag) * walkRate);
  const birdStart = walkStart + walkDur, runStart = birdStart + 1.35;
  const refRunStart = 3.62, refRate = 1.55;
  const refRunDur = refStart.distanceTo(refSpot) / (speed(c.runRef) * refRate);
  const refArrive = refRunStart + refRunDur;

  let screenState = "";
  const shots: Shot[] = [
    { start: 0, end: 2.15, shake: 0.006, eval: (u) => ({ pos: lerpV(V(7.4, 5.4, 7.8), V(4.4, 2.3, 5.4), easeInOut(u)), look: lerpV(V(0, 0.9, 0.2), V(0.1, 1.15, 0.2), u), fov: 34 - 5 * u }) },
    { start: 2.15, end: 3.36, shake: 0.01, eval: (u) => ({ pos: V(-0.05 + 0.25 * u, 1.42, 3.35 - 0.35 * u), look: V(0.08, 1.32, 0.22), fov: 30 }) },
    {
      start: 3.36, end: 3.92, shake: 0.004,
      eval: (u) => {
        const h = L.rig.pos("head");
        return { pos: h.clone().add(V(-1.05 + 0.12 * u, 0.06, 0.78 - 0.1 * u)), look: h.clone().add(V(-0.02, 0.04, 0.04)), fov: 27 };
      },
    },
    { start: 3.92, end: 4.95, shake: 0.012, eval: (u) => ({ pos: V(0.1 + 0.3 * u, 0.42, 3.2), look: lerpV(V(0.9, 0.8, 0.1), V(1.3, 0.35, 0.1), easeOut(u)), fov: 33 }) },
    {
      start: 4.95, end: birdStart + 0.1, shake: 0.01,
      eval: (u) => {
        const wp = W.rig.pos("spine");
        return { pos: V(-1.4 + 1.2 * u, 1.5, 3.9), look: wp.clone().lerp(lChest, 0.45).setY(0.9), fov: 30 };
      },
    },
    {
      // profile: W leaning over him, both middle fingers pointed down
      start: birdStart + 0.1, end: birdStart + 0.72, shake: 0.008,
      eval: (u) => {
        const f = lChest.clone().sub(birdSpot).setY(0).normalize();
        const right = V(-f.z, 0, f.x); // W's right-hand side (toward L's feet, away from the ref)
        const mid = birdSpot.clone().addScaledVector(f, 0.35).add(V(0, 1.15, 0));
        return { pos: mid.clone().addScaledVector(right, 2.2 - 0.25 * u).addScaledVector(f, 0.35).add(V(0, 0.05, 0)), look: mid, fov: 34 };
      },
    },
    {
      // close insert on the hands and his face
      start: birdStart + 0.72, end: runStart + 0.05, shake: 0.006,
      eval: (u) => {
        const f = lChest.clone().sub(birdSpot).setY(0).normalize();
        const right = V(-f.z, 0, f.x); // W's right-hand side (toward L's feet, away from the ref)
        const hands = W.rig.pos("lHand").lerp(W.rig.pos("rHand"), 0.5);
        const face = W.rig.pos("head").add(V(0, 0.05, 0));
        const look = hands.clone().lerp(face, 0.42);
        return { pos: hands.clone().addScaledVector(f, 1.05 - 0.12 * u).addScaledVector(right, 0.55).add(V(0, -0.2, 0)), look, fov: 38 };
      },
    },
    {
      start: runStart + 0.05, end: 99, shake: 0.008,
      eval: (u, s) => {
        const a = -0.2 - (s - runStart) * 0.25;
        const target = W.rig.pos("spine");
        return { pos: lChest.clone().add(V(Math.sin(a) * 4.2, 2.3, Math.cos(a) * 4.2)), look: target.clone().lerp(lChest, 0.5).setY(0.7), fov: 33 };
      },
    },
  ];

  return {
    duration: DURATION,
    eval(t: number) {
      const s = warp(t);

      /* ---------------- loser ---------------- */
      let lPose: Pose, lPos: T.Vector3, lYaw: number;
      if (s < IMPACT) {
        const { dir, d } = lineAt(s);
        lPos = C.clone().addScaledVector(dir, d / 2);
        lYaw = yawTo(lPos, C.clone().addScaledVector(dir, -d / 2));
        // throws the jab that gets slipped (clip jab peaks ~1.0 s)
        const jab = seg(s, 2.2, 2.85);
        lPose = jab > 0 && jab < 1 ? at(c.stance, 0.72 + jab * 0.65) : stancePose(c, s, 0.9);
        if (jab > 0 && jab < 1) lPose = lerpPose(stancePose(c, s, 0.9), lPose, Math.min(1, Math.min(jab, 1 - jab) * 8));
        place(L, lPos, lYaw);
        pose(L, lPose, { ground: 1, face: { browIn: 0.5, jaw: 0.08 } });
      } else {
        lPos = lHit.pos;
        lYaw = lHit.yaw;
        const base = stancePose(c, IMPACT, 0.9);
        const k = s - IMPACT;
        // head snaps away from the hook, body goes limp, timber fall, bounce
        const snap = easeOut(seg(k, 0, 0.12));
        let p = limp(base, smooth(seg(k, 0.05, 0.3)));
        const chest = p.chest.clone();
        p = rotatePose(p, chest, V(0, 0, 1), -0.22 * snap, HEADSET);
        const fallU = seg(k, 0.12, 0.82);
        const theta = (Math.PI / 2 - 0.04) * easeIn(fallU);
        const knee = Math.sin(Math.PI * Math.min(1, fallU * 1.4)) * 0.8 * (1 - fallU);
        let fp = fallPose(p, theta, knee);
        // arms lag behind the fall (inertia) — raise relative to the body
        const lag = Math.sin(Math.PI * fallU) * 0.9;
        fp = rotatePose(fp, fp.lSh.clone(), V(1, 0, 0), -lag * 0.6, ["lEl", "lWr"]);
        fp = rotatePose(fp, fp.rSh.clone(), V(1, 0, 0), -lag * 0.6, ["rEl", "rWr"]);
        if (k >= 0.82) {
          const kk = k - 0.82;
          const fence = smooth(seg(kk, 0.02, 0.18));
          const drop = smooth(seg(kk, 1.1, 1.45));
          const lie = lyingPose(base, fence, drop);
          const bounce = Math.max(0, Math.sin(kk * 18) * Math.exp(-kk * 9)) * 0.05;
          fp = shift(lerpPose(fp, lie, smooth(seg(kk, 0, 0.12))), V(0, bounce, 0), ["hips", "spine", "chest", "neck", "head", "lClav", "rClav", "lSh", "rSh"]);
        }
        place(L, lPos, lYaw);
        const hy = -0.75 * snap * (1 - 0.5 * smooth(seg(k, 0.25, 0.9)));
        pose(L, fp, { face: { eyes: -1 * smooth(seg(k, 0.05, 0.25)), jaw: 0.5 * smooth(seg(k, 0, 0.2)), browIn: 0.2 }, head: [hy, -0.1 * snap, 0.15 * snap] });
      }

      /* ---------------- winner ---------------- */
      if (s < walkStart) {
        const { pos, yaw } = wAt(s);
        place(W, pos, yaw);
        let p = stancePose(c, s, 0);
        // slip the jab: head/torso off the centre line, knees bend
        const slip = bell(s, 2.5, 0.13);
        if (slip > 0.01) {
          p = shift(p, V(-0.14, -0.11, 0.04), UPPER, slip);
          p = shift(p, V(0, -0.07, 0), ["hips", "lHip", "rHip"], slip);
          p = legTo(p, "l", p.lAn.clone(), p.lKn.clone().add(V(0, 0, 0.5)));
          p = legTo(p, "r", p.rAn.clone(), p.rKn.clone().add(V(0, 0, 0.5)));
        }
        // counter right hook: punch clip ~4.78 → 5.62 (peak 5.2)
        const hw = smooth(seg(s, 2.85, 3.08)) * (1 - smooth(seg(s, 3.85, 4.2)));
        if (hw > 0) p = lerpPose(p, at(c.punch, clamp(4.78 + (s - 3.08), 4.78, 5.62)), hw);
        pose(W, p, { ground: 1, face: { browIn: 0.7, jaw: 0.12 + 0.3 * bell(s, IMPACT, 0.08) } });
        // land the hook on the jaw
        const ik = smooth(seg(s, 3.25, 3.47)) * (1 - smooth(seg(s, 3.56, 3.8)));
        if (ik > 0 && s < 4.0) {
          // side of the jaw, on his left
          const tgt = L.rig.pos("head").add(toWorld(V(), lYaw, V(0.07, 0.0, 0.075)));
          const pole = W.rig.pos("rUpper").add(toWorld(V(), wAt(s).yaw, V(-0.5, 0.15, -0.2)));
          punchIK(W, "r", tgt, pole, ik);
        }
      } else if (s < birdStart) {
        const u = s - walkStart;
        const dist = u * speed(c.swag) * walkRate;
        const dir = birdSpot.clone().sub(walkFrom).setY(0).normalize();
        const pos = walkFrom.clone().addScaledVector(dir, Math.min(dist, walkLen));
        const heading = Math.atan2(dir.x, dir.z);
        const turn = smooth(seg(s, birdStart - 0.45, birdStart));
        const yaw = heading + (yawTo(birdSpot, lChest) - heading) * turn;
        place(W, pos, yaw);
        let p = loop(c.swag, u * walkRate + 0.8, 0.6, c.swag.mc.duration - 0.4, 0.3);
        p = lerpPose(stancePose(c, s, 0), p, smooth(seg(s, walkStart, walkStart + 0.35)));
        pose(W, p, { ground: 1, hands: ["relaxed", "relaxed"], face: { smile: 0.4, browIn: 0.3 } });
      } else if (s < runStart + 0.3) {
        const u = s - birdStart;
        const yaw = yawTo(birdSpot, lChest);
        place(W, birdSpot, yaw);
        const last = loop(c.swag, walkDur * walkRate + 0.8, 0.6, c.swag.mc.duration - 0.4, 0.3);
        let p = at(c.neutral, 0.05);
        // lean over him, both middle fingers pointed down at his face
        p = rotatePose(p, p.hips.clone(), V(1, 0, 0), 0.45, UPPER);
        const pump = Math.sin(u * 13) * 0.035;
        p = armTo(p, "l", V(0.2, 0.78 + pump, 0.62), V(0.7, 1.2, 0.2));
        p = armTo(p, "r", V(-0.2, 0.78 - pump, 0.62), V(-0.7, 1.2, 0.2));
        p = rotatePose(p, p.neck.clone(), V(1, 0, 0), 0.35, ["head"]);
        p = lerpPose(last, p, smooth(seg(u, 0, 0.3)));
        const bird = u > 0.12;
        pose(W, p, { ground: 1, hands: bird ? ["bird", "bird"] : ["relaxed", "relaxed"], face: { jaw: 0.35 + 0.1 * Math.sin(u * 9), browIn: 0.9, eyes: 0.2 } });
        if (s > runStart) {
          // blend into the run
          const r = circleRun(c.runSwag, s - runStart, lChest, 1.45, -Math.PI / 2, -1, 1.35);
          const w = smooth(seg(s, runStart, runStart + 0.3));
          place(W, lerpV(birdSpot, r.pos, w), yaw + (r.yaw - yaw) * w);
          pose(W, lerpPose(p, r.pose, w), { ground: 1, hands: ["fist", "fist"], face: { jaw: 0.5, brow: 0.5 } });
        }
      } else {
        const r = circleRun(c.runSwag, s - runStart, lChest, 1.45, -Math.PI / 2, -1, 1.35);
        place(W, r.pos, r.yaw);
        pose(W, r.pose, { ground: 1, hands: ["fist", "fist"], face: { jaw: 0.55, brow: 0.6, smile: 0.3 } });
      }

      /* ---------------- referee ---------------- */
      if (s < refRunStart) {
        const mid = C.clone();
        place(ref, refStart, yawTo(refStart, mid));
        pose(ref, refIdle(c, s), { ground: 1, hands: ["relaxed", "relaxed"] });
      } else if (s < refArrive) {
        const u = s - refRunStart;
        const dir = refSpot.clone().sub(refStart).normalize();
        const pos = refStart.clone().addScaledVector(dir, Math.min(refStart.distanceTo(refSpot), u * speed(c.runRef) * refRate));
        place(ref, pos, Math.atan2(dir.x, dir.z));
        const p = loop(c.runRef, u * refRate + 0.4, 0.3, c.runRef.mc.duration - 0.2, 0.25);
        pose(ref, lerpPose(refIdle(c, s), p, smooth(seg(u, 0, 0.2))), { ground: 1, hands: ["open", "open"], face: { jaw: 0.3 } });
      } else {
        const u = s - refArrive;
        const yaw = yawTo(refSpot, lChest);
        place(ref, refSpot, yaw);
        // waves it off (arms crossing overhead), then crouches over him
        const wave = at(c.wave, 0.9 + u * 1.2);
        let p = lerpPose(loop(c.runRef, 0.4, 0.3, 2, 0.2), wave, smooth(seg(u, 0, 0.25)));
        const crouchW = smooth(seg(u, 1.1, 1.6));
        if (crouchW > 0) {
          // one knee down beside him, leaning in
          let cp = at(c.neutral, 0.05);
          cp = shift(cp, V(0, -0.44, -0.05), ["hips", "spine", "chest", "neck", "head", "lClav", "rClav", "lSh", "rSh", "lEl", "rEl", "lWr", "rWr", "lHip", "rHip"]);
          cp = rotatePose(cp, cp.hips.clone(), V(1, 0, 0), 0.5, UPPER);
          cp = legTo(cp, "r", V(-0.12, 0.1, -0.42), V(-0.12, 0.3, 0.6), 1, V(0, -0.35, -1).normalize());
          cp.rKn.y = Math.max(cp.rKn.y, 0.07);
          cp = legTo(cp, "l", V(0.16, 0.1, 0.36), V(0.16, 0.5, 1.2), 1, V(0, -0.3, 1).normalize());
          cp = armTo(cp, "l", V(0.17, 0.56, 0.33), V(0.6, 0.8, 0));
          cp = armTo(cp, "r", V(-0.1, 0.34, 0.6), V(-0.5, 0.6, 0));
          p = lerpPose(p, cp, crouchW);
        }
        pose(ref, p, { ground: 1, hands: ["open", "open"], face: { jaw: 0.25, brow: 0.3 } });
      }

      /* ---------------- camera, grade, fx ---------------- */
      const shake = s > IMPACT ? 0.06 * Math.exp(-(s - IMPACT) * 9) : 0;
      applyShots(cam, shots, s, shake);
      grade.uniforms.uFlash.value = s > IMPACT ? 0.28 * Math.exp(-(s - IMPACT) / 0.035) : 0;
      grade.uniforms.uFade.value = 1 - smooth(seg(t, 0, 0.35));
      const lh = L.rig.pos("head");
      spray.update(s, IMPACT, lh.clone().add(V(0, -0.04, 0)), toWorld(V(), lHit.yaw, V(-0.7, 0.35, -0.6)));
      const label = s < IMPACT + 0.5 ? "FIGHT NIGHT" : "KNOCKOUT";
      if (label !== screenState) {
        arena.setScreen([label], s < IMPACT + 0.5 ? "#8e0d15" : "#b3121c");
        screenState = label;
      }
      (arena.camFlashes.material as T.ShaderMaterial).uniforms.uTime.value = s * (s > IMPACT ? 2.2 : 1);
      return s;
    },
  };
}
