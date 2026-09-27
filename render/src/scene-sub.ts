import * as T from "three";
import type { Actor } from "./characters";
import { applyShots, noise1, face as faceRig, type Shot } from "./director";
import { bakeRagdoll } from "./ragdoll";
import type { MPose } from "./retarget";
import { V, at, blend, clamp, clipRef, facing, FootLock, limbIK, lookAt, poseFromJoints, rotateAbout, seg, shiftPose, show, smooth, wrapAngle, yawTo, type Joints, type JP } from "./motion";
import { commonClips, idleAt, easeInOut, lerpV, IDLE0, RUN0, RUNF, type Ctx } from "./scene-ko";

/* joint-table helpers (actor space, metres) */
const J = (t: Record<JP, [number, number, number]>) => {
  const o = {} as Joints;
  for (const k of Object.keys(t) as JP[]) o[k] = V(...t[k]);
  return o;
};
const cloneJ = (j: Joints) => {
  const o = {} as Joints;
  for (const k of Object.keys(j) as JP[]) o[k] = j[k].clone();
  return o;
};
const UPPER: JP[] = ["spine", "chest", "neck", "head", "lClav", "lSh", "lEl", "lWr", "rClav", "rSh", "rEl", "rWr"];
function rotJ(j: Joints, pivot: T.Vector3, axis: T.Vector3, ang: number, only: JP[] = UPPER) {
  const q = new T.Quaternion().setFromAxisAngle(axis.clone().normalize(), ang);
  const o = cloneJ(j);
  for (const k of only) o[k].sub(pivot).applyQuaternion(q).add(pivot);
  return o;
}
function legIK(j: Joints, s: "l" | "r", ankle: T.Vector3, pole: T.Vector3) {
  const hp = j[`${s}Hip`], l1 = 0.398, l2 = 0.395;
  const d = Math.min(ankle.distanceTo(hp), (l1 + l2) * 0.999);
  const dir = ankle.clone().sub(hp).normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pd = pole.clone().sub(hp);
  pd.addScaledVector(dir, -pd.dot(dir)).normalize();
  const o = cloneJ(j);
  const toe = o[`${s}Toe`].clone().sub(o[`${s}An`]);
  o[`${s}Kn`] = hp.clone().addScaledVector(dir, cosA * l1).addScaledVector(pd, sinA * l1);
  o[`${s}An`] = hp.clone().addScaledVector(dir, d);
  o[`${s}Toe`] = o[`${s}An`].clone().add(toe);
  return o;
}

/* ======================================================================
 * SUBMISSION — standing exchange, cut to the rear-naked choke on the mat,
 * tap, ref pulls W off, L goes limp (ragdoll), W gets up and pulls the
 * clown face.
 * ====================================================================== */
export async function subScript(ctx: Ctx) {
  const { W, L, ref, cam, grade, arena, scene } = ctx;
  const c = await commonClips();
  const W0 = 12.0, L0 = 10.0;
  const cW = await clipRef("cmu_13_17", W0); // CMU 13_17 boxing
  const cL = await clipRef("cmu_14_02", L0); // CMU 14_02 boxing
  const getUp = await clipRef("cmu_77_18", 3.9); // CMU 77_18 laying down on back, getting up
  const DURATION = 7.63;
  const CUT = 1.75, TAP = 3.85, RELEASE = 4.75, UP = 5.25, CLOWN = 6.15;

  /* ---------- standing exchange (squared up) ---------- */
  const C = V(0.0, 0, 0.4);
  const wS = (s: number) => at(cW, W0 - CUT + s, 0, V());
  const lS = (s: number) => at(cL, L0 - CUT + s, 0, V());
  const standPose = (who: "w" | "l", s: number) => {
    const p = who === "w" ? wS(s) : lS(s);
    const target = who === "w" ? Math.PI / 2 : -Math.PI / 2; // W faces +X from the left
    const d = 1.75 - 0.25 * smooth(seg(s, 0.2, CUT));
    const spot = C.clone().add(V(who === "w" ? -d / 2 : d / 2, 0, 0));
    // yaw so the hips facing points at the opponent, then move the hips onto the spot
    const f = facing(p, "hips");
    const yaw = wrapAngle(target - f - 0.35);
    let q = rotateAbout(p, yaw, p.hips);
    q = shiftPose(q, spot.clone().sub(q.hips.clone().setY(0)));
    return q;
  };
  const wFeetS = new FootLock(W, (s) => show(W, standPose("w", s)), 0, CUT);
  const lFeetS = new FootLock(L, (s) => show(L, standPose("l", s)), 0, CUT);

  /* ---------- the choke (both sit, L in front; actor space of L) ---------- */
  const G = V(0.15, 0, 0.05);
  const gYaw = 0.35;
  const lSit = J({
    hips: [0, 0.14, 0], spine: [0, 0.26, -0.04], chest: [0, 0.52, -0.13], neck: [0, 0.74, -0.2], head: [0, 0.84, -0.13],
    lClav: [0.03, 0.71, -0.19], lSh: [0.18, 0.69, -0.17], rClav: [-0.03, 0.71, -0.19], rSh: [-0.18, 0.69, -0.17],
    lEl: [0.28, 0.55, -0.04], lWr: [0.08, 0.72, -0.03], rEl: [-0.26, 0.55, -0.02], rWr: [-0.05, 0.72, -0.05],
    lHip: [0.09, 0.14, 0], lKn: [0.22, 0.42, 0.32], lAn: [0.27, 0.1, 0.62], lToe: [0.3, 0.02, 0.75],
    rHip: [-0.09, 0.14, 0], rKn: [-0.2, 0.38, 0.33], rAn: [-0.31, 0.1, 0.63], rToe: [-0.34, 0.02, 0.76],
  });
  const wBehind = J({
    hips: [0, 0.15, -0.29], spine: [0, 0.27, -0.32], chest: [-0.01, 0.55, -0.37], neck: [-0.05, 0.79, -0.33], head: [-0.11, 0.89, -0.25],
    lClav: [0.02, 0.76, -0.36], lSh: [0.18, 0.77, -0.34], rClav: [-0.04, 0.76, -0.36], rSh: [-0.16, 0.77, -0.31],
    rEl: [0.0, 0.76, -0.04], rWr: [0.15, 0.83, -0.18], lEl: [0.17, 0.88, -0.04], lWr: [0.03, 0.95, -0.24],
    lHip: [0.09, 0.15, -0.29], lKn: [0.36, 0.34, -0.05], lAn: [0.2, 0.17, 0.2], lToe: [0.12, 0.12, 0.3],
    rHip: [-0.09, 0.15, -0.29], rKn: [-0.36, 0.34, -0.05], rAn: [-0.2, 0.17, 0.2], rToe: [-0.12, 0.12, 0.3],
  });
  const X = V(1, 0, 0), Z = V(0, 0, 1);
  const lChoke = (s: number) => {
    const u = s - CUT;
    const sq = smooth(seg(u, 0, 1.2));
    let j = rotJ(lSit, lSit.hips, X, -0.14 * sq);
    // struggle: shoulders twist, legs kick and slide
    j = rotJ(j, j.hips, V(0, 1, 0), 0.08 * noise1(u * 2.3, 3));
    const kick = (k: number, f: number) => V(0, 0.05 * Math.max(0, Math.sin(u * f + k)), 0.1 * Math.sin(u * f * 0.5 + k));
    j = legIK(j, "l", j.lAn.clone().add(kick(0, 7)), j.lKn.clone().add(V(0.2, 0.5, 0)));
    j = legIK(j, "r", j.rAn.clone().add(kick(2, 6)), j.rKn.clone().add(V(-0.2, 0.5, 0)));
    // head forced forward/sideways by the arm
    j.head.add(V(0.0, -0.025 * sq, 0.03 * sq));
    return poseFromJoints(j, gYaw, G);
  };
  const wChoke = (s: number) => {
    const u = s - CUT;
    const sq = smooth(seg(u, 0, 1.2)) + 0.25 * smooth(seg(s, TAP - 0.6, TAP));
    let j = rotJ(wBehind, wBehind.hips, X, -0.12 * sq);
    j = rotJ(j, j.hips, Z, 0.04 * Math.sin(u * 1.7));
    // hooks: heels dig into his thighs
    j = legIK(j, "l", V(0.19, 0.18, 0.2 + 0.03 * Math.sin(u * 3)), V(0.7, 0.4, -0.1));
    j = legIK(j, "r", V(-0.19, 0.18, 0.2 + 0.03 * Math.sin(u * 3 + 1)), V(-0.7, 0.4, -0.1));
    return poseFromJoints(j, gYaw, G);
  };

  /* ---------- release: L goes limp (ragdoll), W rolls out and stands ---------- */
  const lGrip = (s: number) => {
    show(L, lChoke(s), { hands: ["fist", "fist"] });
    // both hands pull at the choking forearm
    show(W, wChoke(s));
    const fa = W.rig.pos("rFore").lerp(W.rig.pos("rHand"), 0.45);
    limbIK(L, "lArm", fa.clone().add(V(0.02, 0.03, 0)), L.rig.pos("lUpper").add(V(0.3, -0.3, 0.2)), 1);
    limbIK(L, "rArm", W.rig.pos("rFore").lerp(W.rig.pos("rHand"), 0.1).add(V(0, 0.03, 0)), L.rig.pos("rUpper").add(V(-0.3, -0.3, 0.2)), 1);
  };
  const lRag = await bakeRagdoll(L.rig, (s) => lGrip(s), RELEASE, {
    duration: 4,
    velScale: 0.2,
    impulses: [{ key: "torso", impulse: V(Math.sin(gYaw + 1.2), 0, Math.cos(gYaw + 1.2)).multiplyScalar(-2.5) }, { key: "head", impulse: V(0.4, 0, 0) }],
    tone: () => 1,
    toneFor: (k, t) => (/head/.test(k) ? 0.08 : /torso/.test(k) ? Math.max(0.05, 0.4 - t) : 0.04),
  });
  const lRest = lRag.bodyPos("torso", 2.5);

  // W: from behind him → roll out to his left side onto hands and knees → mocap get-up
  const wSeat = wChoke(RELEASE);
  const gFwd = V(Math.sin(gYaw), 0, Math.cos(gYaw));
  const gLeft = V(Math.cos(gYaw), 0, -Math.sin(gYaw));
  const upSpot = G.clone().addScaledVector(gLeft, 0.95).addScaledVector(gFwd, 0.35);
  const upYaw = wrapAngle(yawTo(upSpot, upSpot.clone().addScaledVector(gFwd, 1).addScaledVector(gLeft, 0.9)) - facing(at(getUp, 3.9), "hips"));
  const getUpAt = (t: number) => {
    const p0 = at(getUp, 3.9, upYaw);
    return at(getUp, t, upYaw, upSpot.clone().sub(p0.hips.clone().setY(0)));
  };
  const wUp = (s: number): MPose => {
    const u = s - RELEASE;
    const g = getUpAt(3.9 + Math.max(0, u - 0.25) * 1.8);
    return blend(wSeat, g, smooth(seg(u, 0.05, 0.6)));
  };
  // clown taunt: settle to standing, turn to the camera
  const camSpot = upSpot.clone().addScaledVector(gFwd, 2.2).addScaledVector(gLeft, 0.6);
  const clownBase = (s: number) => {
    const end = wUp(UP + 1.1);
    const idleYaw = wrapAngle(yawTo(end.hips, camSpot) - facing(at(c.idle, IDLE0), "hips"));
    const standAt = end.hips.clone().setY(0);
    const idle = idleAt(c.idle, s, 5, idleYaw, standAt.clone().sub(at(c.idle, IDLE0, idleYaw).hips.clone().setY(0)));
    return blend(wUp(Math.min(s, UP + 1.1)), idle, smooth(seg(s, UP + 0.5, CLOWN + 0.2)));
  };
  const wPose = (s: number) => (s < CUT ? standPose("w", s) : s < RELEASE ? wChoke(s) : s < UP + 0.75 ? wUp(s) : clownBase(s));
  const wFeet = new FootLock(W, (s) => show(W, wPose(s)), RELEASE + 0.5, DURATION);

  /* ---------- referee ---------- */
  const refStart = G.clone().addScaledVector(gLeft, -2.4).addScaledVector(gFwd, -1.1);
  const refSpot = G.clone().addScaledVector(gLeft, -0.75).addScaledVector(gFwd, -0.05);
  const refRun0 = TAP + 0.1;
  const runYaw = yawTo(refStart, refSpot);
  const runClipYaw = wrapAngle(runYaw - facing(at(c.run, RUNF), "hips"));
  const runOrigin = refStart.clone().sub(at(c.run, RUN0, runClipYaw).hips.clone().setY(0));
  let refArrive = refRun0 + 1.5;
  for (let u = 0; u < 3; u += 0.02) {
    if (at(c.run, RUN0 + u * 1.4, runClipYaw, runOrigin).hips.clone().setY(0).distanceTo(refStart) > refStart.distanceTo(refSpot) - 0.2) { refArrive = refRun0 + u; break; }
  }
  const refYaw0 = wrapAngle(yawTo(refStart, G) - facing(at(c.idle, IDLE0), "hips"));
  const refPose = (s: number): MPose => {
    const idle0 = idleAt(c.idle, s, 7, refYaw0, refStart.clone().sub(at(c.idle, IDLE0, refYaw0).hips.clone().setY(0)));
    if (s < refRun0) return idle0;
    const u = s - refRun0;
    const pr = at(c.run, RUN0 + Math.min(u, refArrive - refRun0 + 0.15) * 1.4, runClipYaw, runOrigin);
    let p = blend(idle0, pr, smooth(seg(u, 0, 0.2)));
    if (s > refArrive - 0.1) {
      const stopAt = pr.hips.clone().setY(0);
      const y2 = wrapAngle(yawTo(refSpot, G) - facing(at(c.idle, IDLE0), "hips"));
      const pi = idleAt(c.idle, s, 8, y2, stopAt.clone().sub(at(c.idle, IDLE0, y2).hips.clone().setY(0)));
      p = blend(p, pi, smooth(seg(s, refArrive - 0.1, refArrive + 0.3)));
    }
    return p;
  };
  const refFeet = new FootLock(ref, (s) => show(ref, refPose(s)), 0, DURATION);

  /* ---------- cameras ---------- */
  const gc = G.clone().add(V(0, 0.6, 0));
  const shots: Shot[] = [
    { start: 0, end: 1.05, shake: 0.005, eval: (u) => ({ pos: lerpV(V(-6.4, 4.6, 7.0), V(-3.4, 2.1, 4.8), easeInOut(u)), look: lerpV(V(0, 0.9, 0.4), V(0, 1.15, 0.4), u), fov: 33 - 3 * u }) },
    { start: 1.05, end: CUT, shake: 0.009, eval: (u) => ({ pos: V(0.35 - 0.3 * u, 1.42, 3.5), look: V(0, 1.25, 0.4), fov: 30 }) },
    { start: CUT, end: 3.2, shake: 0.007, eval: (u) => ({ pos: gc.clone().addScaledVector(gFwd, 2.25 - 0.45 * u).addScaledVector(gLeft, 0.75 - 0.3 * u).add(V(0, 0.05, 0)), look: gc.clone().addScaledVector(gFwd, -0.15), fov: 31 }) },
    {
      start: 3.2, end: RELEASE, shake: 0.006,
      eval: (u) => {
        const hL = G.clone().add(V(0, 0.8, 0)).addScaledVector(gFwd, -0.15);
        return { pos: hL.clone().addScaledVector(gFwd, 1.05 - 0.1 * u).addScaledVector(gLeft, 0.62).add(V(0, 0.08, 0)), look: hL.clone().addScaledVector(gLeft, 0.1).add(V(0, -0.06, 0)), fov: 30 };
      },
    },
    { start: RELEASE, end: CLOWN - 0.15, shake: 0.01, eval: (u) => ({ pos: gc.clone().addScaledVector(gFwd, 3.1).addScaledVector(gLeft, 1.4 + 0.3 * u).add(V(0, 0.75 + 0.3 * u, 0)), look: gc.clone().addScaledVector(gLeft, 0.35 + 0.3 * u).add(V(0, 0.05 + 0.25 * u, 0)), fov: 34 }) },
    {
      start: CLOWN - 0.15, end: 99, shake: 0.008,
      eval: (u) => {
        const h = W.rig.pos("head");
        const toCam = camSpot.clone().sub(h).setY(0).normalize();
        return { pos: h.clone().addScaledVector(toCam, 1.25 - 0.45 * easeInOut(u)).add(V(0, -0.05, 0)), look: h.clone().add(V(0, -0.02 - 0.03 * (1 - u), 0)), fov: 32 };
      },
    },
  ];

  let screenState = "";
  return {
    duration: DURATION,
    sub: (t: number) => (t > 0.9 && t < 1.75 ? 2 : 1),
    eval(t: number) {
      const s = t;
      /* ----- standing ----- */
      if (s < CUT) {
        show(W, standPose("w", s), { face: { browIn: 0.7 } });
        wFeetS.apply(s);
        lookAt(W, L.rig.pos("head"), 0.5);
        show(L, standPose("l", s), { face: { browIn: 0.5 } });
        lFeetS.apply(s);
      } else if (s < RELEASE) {
        const u = s - CUT;
        /* ----- the choke ----- */
        show(W, wChoke(s), { hands: ["open", "fist"], face: { browIn: 1, jaw: 0.12, smile: -0.45, eyes: -0.35 } });
        show(L, lChoke(s), { hands: ["fist", "fist"], face: { browIn: 1, eyes: -0.4 - 0.4 * smooth(seg(u, 0, 1.5)), jaw: 0.3 + 0.15 * Math.sin(u * 5), smile: -0.7 } });
        // W: right forearm across the throat, hand locked on his own left biceps; left hand behind L's head
        const hq = L.rig.b("head").getWorldQuaternion(new T.Quaternion());
        const throat = L.rig.pos("neck").add(V(0.0, 0.03, 0.06).applyQuaternion(L.rig.b("neck").getWorldQuaternion(new T.Quaternion())));
        const wLb = W.rig.pos("lUpper").lerp(W.rig.pos("lFore"), 0.55);
        limbIK(W, "rArm", wLb.clone().add(V(0, 0.02, 0)), throat.clone().addScaledVector(gFwd, 0.3).add(V(0, -0.05, 0)), 1);
        limbIK(W, "lArm", L.rig.pos("head").add(V(0.06, 0.02, -0.02).applyQuaternion(hq)).addScaledVector(gFwd, -0.1), W.rig.pos("lUpper").addScaledVector(gLeft, 0.35).add(V(0, 0.35, 0)), 1);
        // L's hands on the arm, then the tap
        const fa = W.rig.pos("rFore").lerp(W.rig.pos("rHand"), 0.45);
        const tapU = seg(s, TAP, TAP + 0.75);
        if (tapU > 0 && tapU < 1) {
          const pat = Math.abs(Math.sin(tapU * Math.PI * 3));
          const spot = W.rig.pos("lUpper").lerp(W.rig.pos("lFore"), 0.6).add(V(0, 0.05 + 0.07 * pat, 0));
          limbIK(L, "lArm", spot, L.rig.pos("lUpper").add(V(0.3, -0.2, 0.1)), 1);
          L.rig.hand("l", "open", 1);
        } else limbIK(L, "lArm", fa.clone().add(V(0.02, 0.03 + 0.012 * Math.sin(u * 9), 0)), L.rig.pos("lUpper").add(V(0.3, -0.3, 0.2)), 1);
        limbIK(L, "rArm", W.rig.pos("rFore").lerp(W.rig.pos("rHand"), 0.1).add(V(0, 0.03 - 0.012 * Math.sin(u * 9), 0)), L.rig.pos("rUpper").add(V(-0.3, -0.3, 0.2)), 1);
        // skin flush in L's face as the choke sinks in
        void hq;
      } else {
        /* ----- release ----- */
        const k = s - RELEASE;
        lRag.apply(L.rig, k);
        L.rig.hand("l", "relaxed", 1);
        L.rig.hand("r", "relaxed", 1);
        faceRig(L.rig, { eyes: -0.8, jaw: 0.45, browIn: 0.1 });
        const clown = s > CLOWN;
        const wp = wPose(s);
        show(W, wp, { hands: clown ? ["spread", "spread"] : ["relaxed", "relaxed"], face: clown ? { tongue: smooth(seg(s, CLOWN + 0.05, CLOWN + 0.3)), jaw: 0.85, brow: 1.4, eyes: 1.2, smile: 0.7 } : { jaw: 0.3, brow: 0.4 } });
        wFeet.apply(s);
        if (s > CLOWN - 0.3) {
          const u = s - (CLOWN - 0.3);
          const e = smooth(seg(u, 0, 0.35));
          const hq = W.rig.b("head").getWorldQuaternion(new T.Quaternion());
          // thumbs at the temples: head space +Z = left, +X up, +Y face
          for (const [sd, sg] of [["l", 1], ["r", -1]] as const) {
            const temple = W.rig.pos("head").add(V(0.06, 0.02, 0.1 * sg).applyQuaternion(hq));
            limbIK(W, sd === "l" ? "lArm" : "rArm", temple, W.rig.pos(`${sd}Upper`).add(V(0, -0.15, 0)).add(V(0, 0, 0.5 * sg).applyQuaternion(hq)), e, false);
            // palm forward, fingers up, waving
            const hb = W.rig.b(`${sd}Hand`);
            const up = V(1, 0, 0).applyQuaternion(hq);
            const fwd = V(0, 1, 0).applyQuaternion(hq);
            const x = up.clone().addScaledVector(V(0, 0, sg).applyQuaternion(hq), 0.35).normalize();
            const y = fwd.clone().addScaledVector(x, -fwd.dot(x)).normalize();
            const want = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, new T.Vector3().crossVectors(x, y)));
            want.multiply(new T.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.sin(u * 15 + (sd === "l" ? 0 : 1.6)) * 0.45));
            const cur = hb.getWorldQuaternion(new T.Quaternion());
            const pq = hb.parent!.getWorldQuaternion(new T.Quaternion());
            hb.quaternion.copy(pq.invert().multiply(cur.slerp(want, e)));
            hb.updateMatrixWorld(true);
          }
          // goofy head waggle
          const hb = W.rig.b("head");
          hb.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(Math.sin(u * 6) * 0.18 * e, 0, Math.sin(u * 6 + 1) * 0.12 * e)));
          hb.updateMatrixWorld(true);
          if (u < 0.35) lookAt(W, camSpot.clone().add(V(0, 1.6, 0)), 1);
        } else lookAt(W, L.rig.pos("head"), 0.6);
      }

      /* ----- referee ----- */
      show(ref, refPose(s), { hands: ["open", "open"], face: s > refRun0 ? { jaw: 0.3, brow: 0.3 } : {} });
      refFeet.apply(s);
      if (s > refArrive - 0.1 && s < UP + 0.6) {
        // reaches in: one hand on W's shoulder, the other on L's chest
        const e = smooth(seg(s, refArrive - 0.1, refArrive + 0.2)) * (1 - smooth(seg(s, UP + 0.2, UP + 0.6)));
        limbIK(ref, "rArm", W.rig.pos("rClav").add(V(0, 0.05, 0)), ref.rig.pos("rUpper").add(V(0, -0.4, 0)), e, false);
        limbIK(ref, "lArm", L.rig.pos("spine2").add(V(0, 0.1, 0)), ref.rig.pos("lUpper").add(V(0, -0.4, 0)), e * 0.8, false);
        lookAt(ref, L.rig.pos("head"), 0.8);
      } else lookAt(ref, s < CUT ? C.clone().add(V(0, 1.4, 0)) : G.clone().add(V(0, 0.7, 0)), 0.8);

      /* ----- camera & grade ----- */
      applyShots(cam, shots, s);
      grade.uniforms.uFlash.value = s > CUT ? 0.25 * Math.exp(-(s - CUT) / 0.05) : 0;
      grade.uniforms.uFade.value = 1 - smooth(seg(t, 0, 0.3));
      if (ctx.post) {
        const f = s > CLOWN - 0.15 ? W.rig.pos("head") : s > 3.2 && s < RELEASE ? L.rig.pos("head") : s > CUT && s < 3.2 ? L.rig.pos("head") : null;
        ctx.post.focus(f ? cam.position.distanceTo(f) : 0, f ? (s > CLOWN - 0.15 ? 0.45 : 0.6) : 0);
        ctx.post.blurImpact(0);
      }
      const label = s < TAP + 0.5 ? "FIGHT NIGHT" : "SUBMISSION";
      if (label !== screenState) {
        arena.setScreen([label], "#b3121c");
        screenState = label;
      }
      (arena.camFlashes.material as T.ShaderMaterial).uniforms.uTime.value = s * (s > TAP ? 2.2 : 1);
      void scene; void clamp;
      return s;
    },
  };
}
