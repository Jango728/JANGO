import * as T from "three";
import type { Actor } from "./characters";
import type { Arena } from "./arena";
import { applyShots, noise1, type Shot } from "./director";
import { makeSpray, timeWarp } from "./fx";
import { bakeRagdoll } from "./ragdoll";
import { clonePose2, type ClipRef, type MPose } from "./retarget";
import { V, at, blend, clamp, clipRef, facing, FootLock, lookAt, punchContact, rotateAbout, seg, shiftPose, show, smooth, wrapAngle, yawTo, limbIK } from "./motion";

export type Ctx = { W: Actor; L: Actor; ref: Actor; arena: Arena; cam: T.PerspectiveCamera; grade: { uniforms: Record<string, { value: any }> }; scene: T.Scene; post?: any };

/* ------------------------------------------------------------------ *
 * Shared building blocks
 * ------------------------------------------------------------------ */
/* clip times (seconds) in the CMU takes; frame 0 of every CMU file is a T-pose, so never sample t < 0.05 */
export const IDLE0 = 1.0, WALK0 = 0.2, WALKF = 0.8, RUN0 = 0.15, RUNF = 0.6;
export async function commonClips() {
  return {
    idle: await clipRef("cmu_77_02", IDLE0), // CMU 77_02 "standing"
    walk: await clipRef("cmu_07_01", WALK0), // CMU 07_01 walk
    run: await clipRef("cmu_16_08", RUN0), // CMU 16_08 run/jog, sudden stop
  };
}
export type Clips = Awaited<ReturnType<typeof commonClips>>;

/** a living idle: slowly wanders through the standing part of the walk take */
export function idleAt(c: ClipRef, s: number, seed: number, yaw: number, pos: T.Vector3) {
  const u = 1.0 + 2.6 * (0.5 + 0.5 * Math.sin(s * 0.4 + seed * 2.1));
  return at(c, u, yaw, pos.clone().setY(0));
}

/** upper-body lean: rotate the spine chain (and everything above) about the actor's local right axis */
export function lean(p: MPose, pitch: number, yawFacing: number, roll = 0) {
  const o = clonePose2(p);
  const right = V(Math.cos(yawFacing), 0, -Math.sin(yawFacing)); // actor's left→right is -X rotated; use +X-ish axis for pitch forward
  const fwd = V(Math.sin(yawFacing), 0, Math.cos(yawFacing));
  const Rp = (w: number) => new T.Quaternion().setFromAxisAngle(right, pitch * w).multiply(new T.Quaternion().setFromAxisAngle(fwd, roll * w));
  const chain: [keyof MPose["q"], number][] = [["spine", 0.3], ["spine1", 0.65], ["spine2", 1], ["neck", 1], ["head", 1], ["lClav", 1], ["rClav", 1], ["lUpper", 1], ["rUpper", 1], ["lFore", 1], ["rFore", 1], ["lHand", 1], ["rHand", 1]];
  for (const [k, w] of chain) o.q[k].premultiply(Rp(w));
  return o;
}

export const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
export const lerpV = (a: T.Vector3, b: T.Vector3, u: number) => a.clone().lerp(b, u);

/* ======================================================================
 * KNOCKOUT — L jabs, W slips and lands the counter right hook, L drops
 * (physics ragdoll), ref waves it off, POV from the canvas looking up at
 * W flipping double birds.
 * ====================================================================== */
export async function koScript(ctx: Ctx) {
  const { W, L, ref, cam, grade, arena, scene } = ctx;
  const c = await commonClips();
  const cW = await clipRef("cmu_13_18", 19.84); // CMU 13_18 boxing: slip (~19.4) + looping right (peak ~19.9)
  const cL = await clipRef("cmu_14_01", 15.75); // CMU 14_01 boxing: steps in with the jab at 15.30
  const spray = makeSpray(scene);

  const IMPACT = 2.62;
  const wT = (s: number) => 19.84 + (s - IMPACT);
  const lT = (s: number) => 15.75 + (s - IMPACT);
  const warp = timeWarp([{ from: IMPACT - 0.1, to: IMPACT + 2.0, rate: 0.3, ramp: 0.14 }], 14);
  const DURATION = 8.6;

  /* ---------- solve the placement so the hook meets the jaw ---------- */
  const posW = V(-0.45, 0, 0.3);
  const yawW = wrapAngle(Math.PI / 2 - facing(at(cW, wT(IMPACT - 0.75)), "hips"));
  const wBase = (s: number) => at(cW, wT(s), yawW, posW);
  show(W, wBase(IMPACT));
  const knuckles = () => {
    const h = W.rig.pos("rHand");
    return h.clone().addScaledVector(V(1, 0, 0).applyQuaternion(W.rig.b("rHand").getWorldQuaternion(new T.Quaternion())), 0.09);
  };
  const G = knuckles();
  const HW = W.rig.pos("head");
  // L yaw: face W's head at the moment of the jab
  const fL = facing(at(cL, lT(IMPACT - 0.45)), "hips");
  let yawL = wrapAngle(yawTo(G, HW) - fL);
  let posL = V();
  const jawOf = (a: Actor) => {
    const hq = a.rig.b("head").getWorldQuaternion(new T.Quaternion());
    // Rocketbox head: +X up, +Y face, +Z = actor's left
    return a.rig.pos("head").add(V(-0.045, 0.075, 0.055).applyQuaternion(hq));
  };
  for (let it = 0; it < 3; it++) {
    show(L, at(cL, lT(IMPACT), yawL, posL));
    const jaw = jawOf(L);
    posL.add(G.clone().sub(jaw).setY(0));
    // keep L facing W's head
    show(L, at(cL, lT(IMPACT), yawL, posL));
    yawL += wrapAngle(yawTo(L.rig.pos("head"), HW) - facing(at(cL, lT(IMPACT), yawL, posL), "hips")) * 0.5;
  }
  // bring L ~11 cm inside the hook's full reach: the contact IK then keeps W's elbow bent (a real hook, not a push)
  posL.add(HW.clone().sub(G).setY(0).normalize().multiplyScalar(0.11));
  const lBase = (s: number) => at(cL, lT(s), yawL, posL);

  /* ---------- keep them squared up before the exchange (fades out before the jab) ---------- */
  const approachW = (s: number) => 1 - smooth(seg(s, IMPACT - 1.0, IMPACT - 0.55));
  const lPre = (s: number) => {
    let p = lBase(s);
    const w = approachW(s);
    if (w > 0) {
      const pw = wBase(s);
      const hL = p.hips.clone(), hW = pw.hips.clone();
      const err = wrapAngle(yawTo(hL, hW) - facing(p, "hips") - (yawTo(lBase(IMPACT).hips, wBase(IMPACT).hips) - facing(lBase(IMPACT), "hips")));
      p = rotateAbout(p, clamp(err, -0.9, 0.9) * w, hL);
      const d = Math.hypot(hL.x - hW.x, hL.z - hW.z);
      const want = clamp(d, 1.7, 2.3);
      const dir = hL.clone().sub(hW).setY(0).normalize();
      p = shiftPose(p, dir.multiplyScalar((want - d) * w));
    }
    return p;
  };
  const wPre = (s: number) => {
    let p = wBase(s);
    const w = approachW(s);
    if (w > 0) {
      const pl = lBase(s);
      const err = wrapAngle(yawTo(p.hips, pl.hips) - facing(p, "hips") - (yawTo(wBase(IMPACT).hips, lBase(IMPACT).hips) - facing(wBase(IMPACT), "hips")));
      p = rotateAbout(p, clamp(err, -0.9, 0.9) * w, p.hips);
    }
    return p;
  };

  /* ---------- L: animated until the hook lands, then ragdoll ---------- */
  const lPoseAnim = (s: number) => {
    show(L, lPre(s), { face: { browIn: 0.55, jaw: 0.06 } });
    // after his jab both hands come back toward the guard (the slipped jab leaves him open to the hook)
    const g = smooth(seg(s, IMPACT - 0.34, IMPACT - 0.12));
    if (g > 0) {
      const hq = L.rig.b("head").getWorldQuaternion(new T.Quaternion());
      // head space: +X up, +Y face, +Z left
      limbIK(L, "rArm", L.rig.pos("head").add(V(-0.13, 0.2, -0.1).applyQuaternion(hq)), L.rig.pos("rUpper").add(V(0, -0.4, 0)), g, false);
      limbIK(L, "lArm", L.rig.pos("head").add(V(-0.1, 0.3, 0.12).applyQuaternion(hq)), L.rig.pos("lUpper").add(V(0, -0.4, 0)), g * 0.8, false);
    }
  };
  const lRag = await bakeRagdoll(L.rig, lPoseAnim, IMPACT, {
    duration: 6,
    velScale: 0.1,
    settle: 0.9,
    // once down, roll him onto his back (so the POV finale looks up from the canvas)
    onStep: (t, bodies) => {
      if (t < 0.55 || t > 2.2) return;
      for (const [key, gain] of [["torso", 60], ["pelvis", 25]] as const) {
        const b = bodies[key];
        const r = b.rotation();
        const q = new T.Quaternion(r.x, r.y, r.z, r.w);
        const fwd = V(0, 1, 0).applyQuaternion(q), axis = V(1, 0, 0).applyQuaternion(q);
        if (fwd.y > 0.75 || Math.abs(axis.y) > 0.5 || b.translation().y > 0.4) continue;
        const want = new T.Vector3().crossVectors(fwd, V(0, 1, 0));
        const tq = axis.multiplyScalar(want.dot(axis) >= 0 ? 1 : -1).multiplyScalar(gain * (1 - fwd.y) * (1 / 240));
        b.applyTorqueImpulse({ x: tq.x, y: tq.y, z: tq.z }, true);
      }
    },
    impulses: (() => {
      // hook drives the head toward L's right and back; torso pushed back
      show(L, lPre(IMPACT));
      const hq = L.rig.b("head").getWorldQuaternion(new T.Quaternion());
      const lLeft = V(0, 0, 1).applyQuaternion(hq).setY(0).normalize();
      const lFwd = V(0, 1, 0).applyQuaternion(hq).setY(0).normalize();
      return [
        { key: "head", impulse: lLeft.clone().multiplyScalar(-3.2).addScaledVector(lFwd, -4.0).add(V(0, 0.3, 0)) },
        { key: "torso", impulse: lFwd.clone().multiplyScalar(-24).addScaledVector(lLeft, -2.0).add(V(0, 0.5, 0)) },
        { key: "pelvis", impulse: lFwd.clone().multiplyScalar(-9) },
      ];
    })(),
    tone: () => 1,
    toneFor: (k, t) => (/Thigh|Calf/.test(k) ? Math.max(0.03, 1 - t / 0.55) : /head/.test(k) ? Math.max(0.12, 1 - t / 0.35) * 0.7 : Math.max(0.08, 1 - t / 0.45)),
  });
  const lFeet = new FootLock(L, lPoseAnim, 0, IMPACT);
  // where he ends up
  const settle = 3.2;
  const lHead = lRag.bodyPos("head", settle);
  const lPel = lRag.bodyPos("pelvis", settle);
  const lTorso = lRag.bodyPos("torso", settle);
  const bodyDir = lHead.clone().sub(lPel).setY(0).normalize(); // feet → head
  const side = V(-bodyDir.z, 0, bodyDir.x);

  /* ---------- W after the punch: follow-through, walk over, birds ---------- */
  const wStop = IMPACT + 0.3;
  const wFrom = wBase(wStop);
  const wHipsAt = wFrom.hips.clone().setY(0);
  // stand beside his head, on the side W is already on
  // pick the side whose straight walk keeps clear of his body
  const lFeetPt = lPel.clone().setY(0).addScaledVector(bodyDir, -0.75);
  const bodyPts = [lHead, lTorso, lPel, lFeetPt, lPel.clone().lerp(lFeetPt, 0.5)].map((p) => p.clone().setY(0));
  const clearance = (a: T.Vector3, b: T.Vector3) => Math.min(...bodyPts.map((p) => { const ab = b.clone().sub(a); const u = clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return a.clone().addScaledVector(ab, u).distanceTo(p); }));
  const spotFor = (sg: number) => lHead.clone().setY(0).addScaledVector(side, 0.75 * sg).addScaledVector(bodyDir, -0.42);
  const sgn = clearance(wHipsAt, spotFor(1)) >= clearance(wHipsAt, spotFor(-1)) ? 1 : -1;
  const birdSpot = spotFor(sgn);
  const birdYaw = yawTo(birdSpot, lHead.clone().lerp(lTorso, 0.25));
  const walkStart = IMPACT + 0.95;
  const walkSpeed = at(c.walk, 2.4).hips.setY(0).distanceTo(at(c.walk, WALK0).hips.setY(0)) / (2.4 - WALK0); // m/s of the walk take (scaled)
  const walkDist = Math.max(0.3, wHipsAt.distanceTo(birdSpot) - 0.1);
  const walkYaw0 = yawTo(wHipsAt, birdSpot);
  const walkDur = walkDist / walkSpeed + 0.55;
  const birdStart = walkStart + walkDur;
  const walkClipYaw = wrapAngle(walkYaw0 - facing(at(c.walk, WALKF), "hips"));

  const wPost = (s: number): MPose => {
    // follow-through on the mocap, then settle into a standing idle facing L
    const pPunch = wPre(Math.min(s, wStop + 0.25));
    const idleYaw = wrapAngle(yawTo(wHipsAt, lTorso) - facing(at(c.idle, IDLE0), "hips"));
    const pIdle = idleAt(c.idle, s, 1, idleYaw, wHipsAt.clone().sub(at(c.idle, IDLE0, idleYaw).hips.clone().setY(0)));
    let p = blend(pPunch, pIdle, smooth(seg(s, wStop, wStop + 0.5)));
    if (s > walkStart) {
      const u = s - walkStart;
      const origin = wHipsAt.clone().sub(at(c.walk, WALK0, walkClipYaw).hips.clone().setY(0));
      const pw = at(c.walk, WALK0 + Math.min(u, walkDur - 0.2), walkClipYaw, origin);
      p = blend(p, pw, smooth(seg(u, 0, 0.3)));
    }
    return p;
  };
  const wEnd = wPost(birdStart);
  const birdPose = (s: number) => {
    const u = s - birdStart;
    const fixYaw = wrapAngle(birdYaw - facing(wEnd, "hips"));
    const base = rotateAbout(wEnd, fixYaw * smooth(seg(u, 0, 0.4)), wEnd.hips);
    // settle the stance onto the bird spot
    const toSpot = birdSpot.clone().sub(base.hips.clone().setY(0)).multiplyScalar(smooth(seg(u, 0, 0.5)));
    let p = shiftPose(base, toSpot);
    p = lean(p, 0.62 * smooth(seg(u, 0.05, 0.5)) + 0.03 * Math.sin(u * 7), birdYaw);
    return p;
  };

  /* ---------- referee ---------- */
  const refStart = lPel.clone().addScaledVector(side, -2.6 * sgn).addScaledVector(bodyDir, 0.9);
  const refSpot = lTorso.clone().setY(0).addScaledVector(side, -0.95 * sgn).addScaledVector(bodyDir, -0.2);
  const refRun0 = IMPACT + 0.35;
  const refRate = 1.35;
  const runYaw = yawTo(refStart, refSpot);
  const runClipYaw = wrapAngle(runYaw - facing(at(c.run, RUNF), "hips"));
  const runOrigin = refStart.clone().sub(at(c.run, RUN0, runClipYaw).hips.clone().setY(0));
  // how long until the run take has covered the distance
  let refArrive = refRun0 + 2;
  for (let u = 0; u < 3; u += 0.02) {
    const hp = at(c.run, RUN0 + u * refRate, runClipYaw, runOrigin).hips;
    if (hp.clone().setY(0).distanceTo(refStart) > refStart.distanceTo(refSpot) - 0.25) { refArrive = refRun0 + u; break; }
  }
  const refIdleYaw0 = wrapAngle(yawTo(refStart, lPel) - facing(at(c.idle, IDLE0), "hips"));
  const refPose = (s: number): MPose => {
    const idle0 = idleAt(c.idle, s, 3, refIdleYaw0, refStart.clone().sub(at(c.idle, IDLE0, refIdleYaw0).hips.clone().setY(0)));
    if (s < refRun0) return idle0;
    const u = s - refRun0;
    const pr = at(c.run, RUN0 + Math.min(u, refArrive - refRun0 + 0.2) * refRate, runClipYaw, runOrigin);
    let p = blend(idle0, pr, smooth(seg(u, 0, 0.2)));
    if (s > refArrive - 0.15) {
      const stopAt = pr.hips.clone().setY(0);
      const yaw2 = wrapAngle(yawTo(refSpot, lTorso) - facing(at(c.idle, IDLE0), "hips"));
      const pi = idleAt(c.idle, s, 4, yaw2, stopAt.clone().sub(at(c.idle, IDLE0, yaw2).hips.clone().setY(0)));
      p = blend(p, pi, smooth(seg(s, refArrive - 0.15, refArrive + 0.3)));
    }
    return p;
  };
  const refFeet = new FootLock(ref, (s) => show(ref, refPose(s)), 0, 9);
  const wFeet = new FootLock(W, (s) => show(W, s < IMPACT + 0.05 ? wPre(s) : s < birdStart ? wPost(s) : birdPose(s)), 0, 9);

  /* ---------- cameras (story time) ---------- */
  const mid0 = wBase(IMPACT).hips.clone().lerp(lBase(IMPACT).hips, 0.5).setY(0);
  const lineDir = lBase(IMPACT).hips.clone().sub(wBase(IMPACT).hips).setY(0).normalize();
  const perp = V(-lineDir.z, 0, lineDir.x);
  // pick the side of the line that sees W's face and L's left jaw (the hook side)
  show(L, lBase(IMPACT));
  const lFace = V(0, 1, 0).applyQuaternion(L.rig.b("head").getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
  const lLeftW = V(0, 0, 1).applyQuaternion(L.rig.b("head").getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
  const camSide = Math.sign(perp.dot(lLeftW)) || 1;
  show(W, wBase(IMPACT));
  const hwI = W.rig.pos("head");
  show(L, lBase(IMPACT));
  const hlI = L.rig.pos("head");
  const P = perp.clone().multiplyScalar(camSide);
  const POV = birdStart - 0.1;
  const shots: Shot[] = [
    {
      start: 0, end: 1.25, shake: 0.004,
      eval: (u) => ({ pos: mid0.clone().addScaledVector(P, 7.5 - 3.3 * easeInOut(u)).addScaledVector(lineDir, -2.2 + 1.2 * u).add(V(0, 4.6 - 2.6 * easeInOut(u), 0)), look: mid0.clone().add(V(0, 1.0 + 0.2 * u, 0)), fov: 34 - 4 * u }),
    },
    {
      start: 1.25, end: IMPACT - 0.07, shake: 0.008,
      eval: (u, s) => {
        const m = wPre(s).hips.clone().lerp(lPre(s).hips, 0.5).setY(0);
        return { pos: m.clone().addScaledVector(P, 3.25 - 0.3 * u).addScaledVector(lineDir, -0.35).add(V(0, 1.38, 0)), look: m.clone().add(V(0, 1.3, 0)), fov: 30 };
      },
    },
    {
      // the counter: tight on L's face, hook coming in from frame left
      start: IMPACT - 0.07, end: IMPACT + 0.3, shake: 0.004,
      eval: (u) => {
        // heads midpoint at impact, camera in profile on L's right side (the glove lands on the far jaw
        // and the head snaps toward us)
        const hw = hwI, hl = hlI;
        const m = hw.clone().lerp(hl, 0.62);
        const across = hl.clone().sub(hw).setY(0).normalize();
        let pp = V(-across.z, 0, across.x);
        if (pp.dot(lLeftW) > 0) pp.negate();
        return { pos: m.clone().addScaledVector(pp, 1.35 - 0.12 * u).addScaledVector(across, 0.25).add(V(0, 0.08 - 0.1 * u, 0)), look: m.clone().add(V(0, -0.05 - 0.12 * u, 0)).addScaledVector(across, 0.12 * u), fov: 33 };
      },
    },
    {
      // the drop: low and wide
      start: IMPACT + 0.3, end: walkStart + 0.35, shake: 0.01,
      eval: (u) => {
        const f = lPel.clone().lerp(lHead, 0.4).setY(0);
        return { pos: f.clone().addScaledVector(P, 3.0 - 0.3 * u).addScaledVector(lineDir, -0.8).add(V(0, 0.55 + 0.1 * u, 0)), look: f.clone().add(V(0, 0.45 - 0.1 * u, 0)), fov: 36 };
      },
    },
    {
      // ref waves it off, W walks over
      start: walkStart + 0.35, end: POV, shake: 0.01,
      eval: (u) => {
        const f = lTorso.clone().setY(0);
        return { pos: f.clone().addScaledVector(side, 2.6 * sgn).addScaledVector(bodyDir, -1.9).add(V(0, 1.45, 0)), look: f.clone().lerp(refSpot, 0.35).add(V(0, 0.85, 0)), fov: 34 - 3 * u };
      },
    },
    {
      // POV from the canvas
      start: POV, end: 99, shake: 0.0,
      eval: (u, s) => {
        const eye = lRag.bodyPos("head", Math.min(settle + 2, s - IMPACT)).clone().add(V(0, 0.06, 0));
        const face = W.rig.pos("head");
        const hands = W.rig.pos("lHand").lerp(W.rig.pos("rHand"), 0.5);
        const look = face.clone().lerp(hands, 0.35);
        const sway = V(noise1(s * 0.7, 21), noise1(s * 0.6, 22), noise1(s * 0.5, 23)).multiplyScalar(0.035);
        return { pos: eye.add(sway), look: look.add(sway.clone().multiplyScalar(2)), fov: 52 - 4 * u };
      },
    },
  ];
  const povLight = new T.SpotLight("#ffe6cf", 0, 6, 0.7, 0.8, 1.5);
  scene.add(povLight, povLight.target);
  const lHeadMats: T.Material[] = [];
  L.root.traverse((o) => {
    const m = o as T.Mesh;
    if (!m.isMesh) return;
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) lHeadMats.push(mm);
  });
  const povRoll = (s: number) => (s > POV ? 0.12 * Math.sin(s * 0.8) + 0.08 : 0);

  let screenState = "";
  return {
    duration: DURATION,
    sub: (t: number) => (t > 1.2 && t < 2.55 ? 2 : t >= 2.55 && t < 3.4 ? 3 : 1),
    hideTag: (who: "w" | "l", s: number) => who === "l" && s >= POV,
    eval(t: number) {
      const s = warp(t);

      /* ----- loser ----- */
      if (s < IMPACT) {
        lPoseAnim(s);
        lFeet.apply(s);
        // his jab: reach just past W's head (W slips under it)
        const jab = smooth(seg(s, IMPACT - 0.62, IMPACT - 0.5)) * (1 - smooth(seg(s, IMPACT - 0.44, IMPACT - 0.32)));
        if (jab > 0) {
          const hw = W.rig.pos("head");
          show(W, wPre(s));
          const over = W.rig.pos("head").clone().add(V(0, 0.14, 0));
          lFeetDummy(hw);
          punchContact(L, "l", over.addScaledVector(lineDir.clone().negate(), 0.15), L.rig.pos("lUpper").add(V(0, -0.3, 0)), jab * 0.6);
        }
      } else {
        const k = s - IMPACT;
        lRag.apply(L.rig, k);
        L.rig.hand("l", "relaxed", 1);
        L.rig.hand("r", "relaxed", 1);
        const out = smooth(seg(k, 0.03, 0.2));
        faceSet(L, { eyes: -0.35 - 0.45 * out, jaw: 0.1 + 0.45 * out, browIn: 0.3 * (1 - out), brow: -0.2 * out });
      }

      /* ----- winner ----- */
      let wp: MPose;
      if (s < IMPACT + 0.05) wp = wPre(s);
      else if (s < birdStart) wp = wPost(s);
      else wp = birdPose(s);
      const birding = s > birdStart + 0.18;
      show(W, wp, { hands: birding ? ["bird", "bird"] : s > wStop + 0.4 ? ["relaxed", "relaxed"] : ["fist", "fist"], face: s < IMPACT + 0.3 ? { browIn: 0.8, jaw: 0.12 + 0.35 * Math.exp(-Math.abs(s - IMPACT) * 12) } : birding ? { jaw: 0.4 + 0.1 * Math.sin(s * 9), browIn: 1, eyes: 0.15, smile: -0.2 } : { browIn: 0.4, jaw: 0.15 } });
      wFeet.apply(s);
      // land the hook: knuckles on the jaw at the impact frame
      const ik = smooth(seg(s, IMPACT - 0.16, IMPACT - 0.02)) * (1 - smooth(seg(s, IMPACT + 0.06, IMPACT + 0.3)));
      if (ik > 0) {
        const jaw = s < IMPACT ? jawOf(L) : jawOf(L);
        const wRight = V(-lineDir.z, 0, lineDir.x);
        const pole = W.rig.pos("rUpper").addScaledVector(wRight, 0.6).add(V(0, 0.12, 0)).addScaledVector(lineDir, 0.1);
        punchContact(W, "r", jaw, pole, ik);
      }
      if (birding) {
        const u = s - birdStart - 0.18;
        const pump = Math.sin(u * 10) * 0.03;
        const chest = W.rig.pos("spine2");
        const eye = lHead.clone();
        const toCam = eye.clone().sub(chest).setY(0).normalize();
        const sideW = V(-toCam.z, 0, toCam.x);
        const e = smooth(seg(u, 0, 0.3));
        for (const [sd, sg] of [["l", 1], ["r", -1]] as const) {
          // which side is this hand on (actor's left = +sideW or -sideW)?
          const up0 = W.rig.pos(`${sd}Upper`);
          const sgn2 = Math.sign(up0.clone().sub(chest).dot(sideW)) || sg;
          const tgt = chest.clone().addScaledVector(toCam, 0.44).addScaledVector(sideW, 0.28 * sgn2).add(V(0, -0.2 + (sd === "l" ? pump : -pump), 0));
          limbIK(W, sd === "l" ? "lArm" : "rArm", tgt, up0.clone().addScaledVector(sideW, 0.5 * sgn2).add(V(0, -0.35, 0)), e, false);
          // hand: middle finger straight up, back of the hand to the camera
          const hpos = W.rig.pos(`${sd}Hand`);
          const view = eye.clone().add(V(0, 0.06, 0)).sub(hpos).normalize();
          const scrUp = V(0, 1, 0).addScaledVector(view, -view.y).normalize();
          const want = birdHandQ(W, sd, scrUp, view);
          const hb = W.rig.b(`${sd}Hand`);
          const hq = hb.getWorldQuaternion(new T.Quaternion());
          const g = hq.clone().slerp(want, e);
          const pq = hb.parent!.getWorldQuaternion(new T.Quaternion());
          hb.quaternion.copy(pq.invert().multiply(g));
          hb.updateMatrixWorld(true);
        }
        lookAt(W, lHead, 1);
      } else if (s > wStop + 0.3) lookAt(W, L.rig.pos("head"), 0.8 * smooth(seg(s, wStop + 0.3, wStop + 0.8)));

      /* ----- referee ----- */
      const rp = refPose(s);
      show(ref, rp, { hands: ["open", "open"], face: s > refRun0 ? { jaw: 0.3, brow: 0.3 } : {} });
      refFeet.apply(s);
      if (s > refArrive - 0.1) {
        // waving it off: arms scissor over his head
        const u = s - (refArrive - 0.1);
        const e = smooth(seg(u, 0, 0.25));
        const hd = ref.rig.pos("head");
        const fwdR = V(0, 1, 0).applyQuaternion(ref.rig.b("head").getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
        const sideR = V(-fwdR.z, 0, fwdR.x);
        const sw = Math.sin(u * 9.5) * 0.36;
        limbIK(ref, "lArm", hd.clone().add(V(0, 0.28, 0)).addScaledVector(fwdR, 0.28).addScaledVector(sideR, -sw), ref.rig.pos("lUpper").addScaledVector(sideR, -0.5).add(V(0, -0.2, 0)), e, false);
        limbIK(ref, "rArm", hd.clone().add(V(0, 0.22, 0)).addScaledVector(fwdR, 0.3).addScaledVector(sideR, sw), ref.rig.pos("rUpper").addScaledVector(sideR, 0.5).add(V(0, -0.2, 0)), e, false);
        lookAt(ref, L.rig.pos("head"), 0.7);
      } else lookAt(ref, s < IMPACT ? mid0.clone().add(V(0, 1.4, 0)) : L.rig.pos("head"), 0.8);

      /* ----- camera, grade, fx ----- */
      const shake = s > IMPACT ? 0.05 * Math.exp(-(s - IMPACT) * 7) : 0;
      const shot = applyShots(cam, shots, s, shake);
      if (povRoll(s)) cam.rotateZ(povRoll(s));
      const inPov = s >= POV;
      for (const m of lHeadMats) m.visible = !inPov;
      povLight.intensity = inPov ? 4 : 0;
      if (inPov) {
        povLight.position.copy(cam.position).add(V(0, 0.4, 0)).addScaledVector(bodyDir, -0.3);
        povLight.target.position.copy(W.rig.pos("head"));
      }
      void shot;
      grade.uniforms.uFlash.value = s > IMPACT ? 0.22 * Math.exp(-(s - IMPACT) / 0.03) : 0;
      grade.uniforms.uFade.value = 1 - smooth(seg(t, 0, 0.3));
      if (grade.uniforms.uDaze) grade.uniforms.uDaze.value = s > POV ? 0.6 + 0.4 * Math.sin(s * 2.3) : 0;
      if (ctx.post) {
        // depth of field: focus on L's face in the close-up, W in the POV
        const focusTarget = s > POV ? W.rig.pos("lHand").lerp(W.rig.pos("head"), 0.3) : s > IMPACT - 0.07 && s < IMPACT + 0.3 ? L.rig.pos("head") : null;
        ctx.post.focus(focusTarget ? cam.position.distanceTo(focusTarget) : 0, s > POV ? 0.45 : s > IMPACT - 0.07 && s < IMPACT + 0.3 ? 0.9 : 0);
        ctx.post.blurImpact(s > IMPACT && s < IMPACT + 0.25 ? 1 - (s - IMPACT) / 0.25 : 0);
      }
      const lh = L.rig.pos("head");
      spray.update(s, IMPACT, lh.clone().add(V(0, -0.03, 0)), lineDir.clone().add(V(0, 0.25, 0)).addScaledVector(lLeftW, -0.8));
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

import { face as faceRig, type Face } from "./director";
function faceSet(a: Actor, f: Face) {
  faceRig(a.rig, f);
}
function lFeetDummy(_v: T.Vector3) {}

/** world orientation for a hand so its extended middle finger points along `up` and the back of the hand faces `toViewer` */
export function birdHandQ(a: Actor, sd: "l" | "r", up: T.Vector3, toViewer: T.Vector3) {
  const r = a.rig;
  const hb = r.b(`${sd}Hand`);
  const hq = hb.getWorldQuaternion(new T.Quaternion());
  const inv = hq.clone().invert();
  const S = sd === "l" ? "L" : "R";
  const base = r.bones[`Bip01_${S}_Finger2`].getWorldPosition(new T.Vector3());
  const tip = r.bones[`Bip01_${S}_Finger22`].getWorldPosition(new T.Vector3());
  const fL = tip.sub(base).normalize().applyQuaternion(inv);
  const backL = new T.Vector3(0, -1, 0);
  const b1 = basis3(fL, backL), b2 = basis3(up, toViewer);
  return b2.multiply(b1.invert());
}
function basis3(a: T.Vector3, b: T.Vector3) {
  const x = a.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
  const z = new T.Vector3().crossVectors(x, y);
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
}
