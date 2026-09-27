import * as T from "three";
import { applyShots, noise1, type Shot } from "./director";
import type { MPose } from "./retarget";
import { V, at, blend, clipRef, facing, FootLock, limbIK, lookAt, poseFromJoints, rotateAbout, seg, shiftPose, show, smooth, wrapAngle, yawTo, type Joints, type JP } from "./motion";
import { commonClips, idleAt, easeInOut, lerpV, lean, IDLE0, WALK0, WALKF, RUN0, RUNF, type Ctx } from "./scene-ko";
import { FENCE_R, FENCE_H } from "./arena";

const J = (t: Record<JP, [number, number, number]>) => {
  const o = {} as Joints;
  for (const k of Object.keys(t) as JP[]) o[k] = V(...t[k]);
  return o;
};

/* ======================================================================
 * DECISION — ref between both, raises W's hand, W runs and climbs the cage.
 * ====================================================================== */
export async function decScript(ctx: Ctx) {
  const { W, L, ref, cam, grade, arena, scene } = ctx;
  const c = await commonClips();
  const idleL = await clipRef("cmu_77_02", 4.0);
  const walkL = await clipRef("cmu_07_01", WALK0);
  const sadL = await clipRef("cmu_79_71", 1.0); // CMU 79_71 "sad": hand to the face, rubs the neck, head down
  const DURATION = 8.9;
  const RAISE = 2.0, BREAK = 3.7;

  const refPos = V(0, 0, 0.35), wPos = V(-0.78, 0, 0.35), lPos = V(0.78, 0, 0.35);
  const face0 = 0; // everyone faces +Z (toward the main camera)
  const idleYaw = (cl: typeof c.idle, t: number) => wrapAngle(face0 - facing(at(cl, t), "hips"));
  const standAt = (cl: typeof c.idle, t0: number, s: number, seed: number, pos: T.Vector3, yawAdd = 0) => {
    const y = idleYaw(cl, t0) + yawAdd;
    return idleAt(cl, s, seed, y, pos.clone().sub(at(cl, t0, y).hips.clone().setY(0)));
  };

  /* ---------- W: run to the fence, climb, perch ---------- */
  const fenceSpot = V(-0.25, 0, -FENCE_R + 0.02);
  const runTo = fenceSpot.clone().add(V(0, 0, 0.62));
  const runYaw = yawTo(wPos, runTo);
  const runClipYaw = wrapAngle(runYaw - facing(at(c.run, RUNF), "hips"));
  const runOrigin = wPos.clone().sub(at(c.run, RUN0, runClipYaw).hips.clone().setY(0));
  const runRate = 1.5;
  let runArrive = BREAK + 1.5;
  for (let u = 0; u < 3; u += 0.02) {
    if (at(c.run, RUN0 + u * runRate, runClipYaw, runOrigin).hips.clone().setY(0).distanceTo(wPos) > wPos.distanceTo(runTo) - 0.05) { runArrive = BREAK + 0.15 + u; break; }
  }
  const CLIMB = runArrive - 0.05, PERCH = CLIMB + 0.95;
  // climbing: facing the fence (-Z), hands on the top rail, right foot on the mesh
  const climbJ = (k: number): Joints => {
    // local frame: +Z points at the fence (fence plane at z = 0), cage interior is -Z
    const hy = 0.95 + 0.6 * k, hz = -0.34 + 0.16 * k, cz = hz + 0.12;
    return J({
      hips: [0, hy, hz], spine: [0, hy + 0.12, hz + 0.03], chest: [0, hy + 0.38, cz], neck: [0, hy + 0.6, cz + 0.04], head: [0, hy + 0.7, cz + 0.02],
      lClav: [0.03, hy + 0.57, cz + 0.03], lSh: [0.18, hy + 0.56, cz + 0.02], rClav: [-0.03, hy + 0.57, cz + 0.03], rSh: [-0.18, hy + 0.56, cz + 0.02],
      lEl: [0.3, hy + 0.5 + 0.25 * (1 - k), cz + 0.12], lWr: [0.24, FENCE_H + 0.02, -0.06],
      rEl: [-0.3, hy + 0.5 + 0.25 * (1 - k), cz + 0.12], rWr: [-0.24, FENCE_H + 0.02, -0.06],
      lHip: [0.09, hy, hz], lKn: [0.15, hy + 0.05, hz + 0.3], lAn: [0.15, hy - 0.3, -0.07], lToe: [0.15, hy - 0.34, 0.05],
      rHip: [-0.09, hy, hz], rKn: [-0.15, hy - 0.38, hz + 0.12], rAn: [-0.15, Math.max(0.1, hy - 0.78), -0.08], rToe: [-0.15, Math.max(0.03, hy - 0.84), 0.04],
    });
  };
  // perched: sitting on the top rail facing into the cage (+Z), legs hanging inside
  const perchJ = (u: number): Joints => {
    const hy = FENCE_H + 0.13, pump = 0.05 * Math.sin(u * 9);
    return J({
      hips: [0, hy, 0.02], spine: [0, hy + 0.12, 0.0], chest: [0, hy + 0.4, -0.03], neck: [0, hy + 0.62, -0.02], head: [0, hy + 0.72, 0.02],
      lClav: [0.03, hy + 0.59, -0.03], lSh: [0.19, hy + 0.6, -0.03], rClav: [-0.03, hy + 0.59, -0.03], rSh: [-0.19, hy + 0.6, -0.03],
      lEl: [0.36, hy + 0.82 + pump, 0.0], lWr: [0.34, hy + 1.1 + pump, 0.04], rEl: [-0.36, hy + 0.82 - pump, 0.0], rWr: [-0.34, hy + 1.1 - pump, 0.04],
      lHip: [0.1, hy, 0.02], lKn: [0.19, hy - 0.08, 0.4], lAn: [0.2, hy - 0.45 + 0.03 * Math.sin(u * 3), 0.45], lToe: [0.2, hy - 0.5, 0.58],
      rHip: [-0.1, hy, 0.02], rKn: [-0.19, hy - 0.1, 0.39], rAn: [-0.2, hy - 0.48 + 0.03 * Math.sin(u * 3 + 1), 0.42], rToe: [-0.2, hy - 0.53, 0.55],
    });
  };
  const wPose = (s: number): MPose => {
    if (s < BREAK) return standAt(c.idle, IDLE0, s, 1, wPos, 0.1);
    if (s < CLIMB) {
      const u = s - BREAK;
      const pr = at(c.run, RUN0 + Math.max(0, u - 0.12) * runRate, runClipYaw, runOrigin);
      return blend(standAt(c.idle, IDLE0, s, 1, wPos, 0.1), pr, smooth(seg(u, 0, 0.25)));
    }
    const runEnd = at(c.run, RUN0 + (CLIMB - BREAK - 0.12) * runRate, runClipYaw, runOrigin);
    if (s < PERCH) {
      const k = seg(s, CLIMB, PERCH - 0.25);
      const cp = poseFromJoints(climbJ(smooth(k)), Math.PI, fenceSpot.clone().add(V(0, 0, 0)));
      let p = blend(runEnd, cp, smooth(seg(s, CLIMB, CLIMB + 0.3)));
      if (s > PERCH - 0.3) p = blend(p, poseFromJoints(perchJ(0), 0, fenceSpot), smooth(seg(s, PERCH - 0.3, PERCH)));
      return p;
    }
    return poseFromJoints(perchJ(s - PERCH), 0, fenceSpot);
  };
  const wFeet = new FootLock(W, (s) => show(W, wPose(s)), 0, CLIMB);

  /* ---------- L: head drops, walks back to his corner ---------- */
  const lWalkTo = V(3.2, 0, 1.9);
  const lTurn = RAISE + 2.3, SAD = RAISE + 0.25;
  const lWalkYaw = wrapAngle(yawTo(lPos, lWalkTo) - facing(at(walkL, WALKF), "hips"));
  const lPose = (s: number): MPose => {
    let p = standAt(idleL, 4.0, Math.min(s, SAD + 0.6), 2, lPos, -0.1);
    if (s > SAD) {
      // dejected: the mocap gesture, turned slightly away from the winner
      const y = idleYaw(sadL, 1.0) - 0.35;
      const sp = at(sadL, 1.0 + Math.min(s, lTurn + 0.5) - SAD, y, lPos.clone().sub(at(sadL, 1.0, y).hips.clone().setY(0)));
      p = blend(p, sp, smooth(seg(s, SAD, SAD + 0.6)));
    }
    if (s > lTurn) {
      const u = s - lTurn;
      const origin = lPos.clone().sub(at(walkL, WALK0, lWalkYaw).hips.clone().setY(0));
      p = blend(p, at(walkL, WALK0 + Math.min(u * 0.85, 2.3), lWalkYaw, origin), smooth(seg(u, 0, 0.4)));
    }
    return p;
  };
  const lFeet = new FootLock(L, (s) => show(L, lPose(s)), 0, DURATION);

  /* ---------- ref ---------- */
  const refPose = (s: number): MPose => {
    let p = standAt(c.idle, IDLE0, s, 3, refPos);
    // after the break he steps back and turns to watch W
    const k = smooth(seg(s, BREAK, BREAK + 1.0));
    if (k > 0) p = shiftPose(rotateAbout(p, -0.9 * k, p.hips), V(0.45 * k, 0, 0.3 * k));
    return p;
  };
  const refFeet = new FootLock(ref, (s) => show(ref, refPose(s)), 0, DURATION);

  const follow = new T.SpotLight("#fff2de", 0, 14, 0.3, 0.6, 1.2);
  follow.position.set(0.5, 7.5, 1.0);
  follow.target.position.copy(fenceSpot).add(V(0, 2.0, 0));
  scene.add(follow, follow.target);

  /* ---------- cameras ---------- */
  const shots: Shot[] = [
    { start: 0, end: RAISE + 0.55, shake: 0.006, eval: (u) => ({ pos: lerpV(V(0.4, 1.62, 4.4), V(0.15, 1.5, 3.3), easeInOut(u)), look: V(0, 1.3, 0.35), fov: 38 - 6 * u }) },
    { start: RAISE + 0.55, end: BREAK, shake: 0.01, eval: (u) => ({ pos: wPos.clone().add(V(0.35 - 0.15 * u, 1.45, 2.55 - 0.2 * u)), look: wPos.clone().add(V(0.62, 1.5, 0)), fov: 44 }) },
    { start: BREAK, end: CLIMB + 0.3, shake: 0.012, eval: (u) => ({ pos: lerpV(V(-2.3, 1.6, 2.0), V(-2.0, 1.5, -1.0), u), look: W.rig.pos("spine").setY(1.15), fov: 36 }) },
    {
      start: CLIMB + 0.3, end: 99, shake: 0.008,
      eval: (u) => {
        const a = -0.5 + 0.9 * easeInOut(u);
        const base = fenceSpot.clone();
        const r = 3.2 - 0.9 * u;
        return { pos: base.clone().add(V(Math.sin(a) * r, 0.75 + 0.45 * u, Math.cos(a) * r)), look: base.clone().add(V(0, 2.25, 0)), fov: 40 - 4 * u };
      },
    },
  ];

  let screenState = "";
  return {
    duration: DURATION,
    sub: (_t: number) => 1,
    eval(t: number) {
      const s = t;
      const up = easeInOut(seg(s, RAISE, RAISE + 0.55));
      /* ----- ref ----- */
      show(ref, refPose(s), { hands: ["relaxed", "relaxed"], face: { jaw: 0.05 } });
      refFeet.apply(s);
      /* ----- W ----- */
      const perched = s > PERCH - 0.2;
      show(W, wPose(s), { hands: ["fist", "fist"], face: s < RAISE ? { browIn: 0.6 } : { jaw: 0.35 + 0.5 * up * (0.7 + 0.3 * Math.sin(s * 8)), brow: -0.2 * up, browIn: perched ? 0.8 : 0, eyes: perched ? 0.3 : 0 } });
      if (s < CLIMB) wFeet.apply(s);
      if (s < BREAK) {
        // inner (left) wrist in the ref's hand, raised on the decision
        const low = wPos.clone().add(V(0.3, 0.98, 0.07)), high = wPos.clone().add(V(0.3, 2.0, 0.02));
        const wr = low.clone().lerp(high, up).add(V(0, Math.sin(Math.PI * up) * 0.05, 0));
        limbIK(W, "lArm", wr, W.rig.pos("lUpper").add(V(0.5, -0.3 + 0.3 * up, -0.3)), 1, false);
        const other = wPos.clone().add(V(-0.38, 1.05 + 0.95 * up + 0.05 * Math.sin(s * 9) * up, 0.1));
        limbIK(W, "rArm", other, W.rig.pos("rUpper").add(V(-0.5, -0.2, -0.3)), smooth(seg(s, RAISE + 0.25, RAISE + 0.7)), false);
        limbIK(ref, "rArm", W.rig.pos("lHand"), ref.rig.pos("rUpper").add(V(-0.4, -0.4, 0.2)), 1, false);
        lookAt(W, s < RAISE ? V(0, 1.5, 4) : V(-0.5, 3.0, 3), 0.6);
      } else if (s > CLIMB && s < PERCH) {
        // grip the top rail
        const k = seg(s, CLIMB, PERCH - 0.3);
        for (const [sd, x] of [["l", 0.24], ["r", -0.24]] as const)
          limbIK(W, sd === "l" ? "lArm" : "rArm", fenceSpot.clone().add(V(-x, FENCE_H + 0.03, 0)), W.rig.pos(`${sd}Upper`).add(V(0, -0.3, 0.3)), smooth(seg(k, 0, 0.3)) * (1 - smooth(seg(s, PERCH - 0.3, PERCH))), false);
      } else if (perched) {
        lookAt(W, V(Math.sin(s * 1.2) * 3, 3.2, 3), 0.7);
      }
      /* ----- L ----- */
      const drop = smooth(seg(s, RAISE + 0.1, RAISE + 0.4)) * (1 - smooth(seg(s, SAD, SAD + 0.6)));
      let lp = lPose(s);
      lp = lean(lp, 0.12 * drop, -0.1);
      show(L, lp, { hands: ["relaxed", "relaxed"], face: { browIn: 0.7, eyes: -0.3 * drop, smile: -0.5 * drop } });
      lFeet.apply(s);
      if (s < lTurn) {
        // inner (right) wrist held by the ref until the decision
        const held = lPos.clone().add(V(-0.3, 0.98, 0.07));
        if (drop < 1) limbIK(L, "rArm", held, L.rig.pos("rUpper").add(V(-0.4, -0.3, -0.3)), 1 - drop, false);
        if (s < RAISE + 0.35) limbIK(ref, "lArm", L.rig.pos("rHand"), ref.rig.pos("lUpper").add(V(0.4, -0.4, 0.2)), 1 - smooth(seg(s, RAISE, RAISE + 0.35)), false);
      }
      // head hangs
      const hb = L.rig.b("head");
      hb.quaternion.multiply(new T.Quaternion().setFromAxisAngle(V(0, 0, 1), -0.45 * drop));
      hb.updateMatrixWorld(true);
      lookAt(ref, s < RAISE ? V(0, 1.5, 4) : W.rig.pos("head"), 0.7);

      /* ----- camera & grade ----- */
      applyShots(cam, shots, s);
      grade.uniforms.uFlash.value = 0;
      follow.intensity = s > PERCH - 0.3 ? 160 : 0;
      grade.uniforms.uFade.value = 1 - smooth(seg(t, 0, 0.3));
      if (ctx.post) {
        ctx.post.focus(s > RAISE + 0.55 && s < BREAK ? cam.position.distanceTo(W.rig.pos("spine2").lerp(ref.rig.pos("spine2"), 0.3)) : 0, 0.55);
        ctx.post.blurImpact(0);
      }
      const label = s < RAISE ? "DECISION" : "WINNER";
      if (label !== screenState) {
        arena.setScreen([label], "#b3121c");
        screenState = label;
      }
      (arena.camFlashes.material as T.ShaderMaterial).uniforms.uTime.value = s * (s > RAISE ? 2.4 : 1.2);
      void noise1;
      return s;
    },
  };
}
