import * as T from "three";
import { loadMotion, sample, applyMPose, transformPose, blend, clonePose2, type ClipRef, type MPose } from "./retarget";
import type { Actor } from "./characters";
import { face as setFace, type Face, type HandShape } from "./director";

/* ------------------------------------------------------------------ *
 * Scene-level helpers on top of the retargeter: world-space poses,
 * actor posing, look-at, stable foot locking and punch contact IK.
 * Actors keep their root at the origin; poses carry world placement.
 * ------------------------------------------------------------------ */

export const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const UP = V(0, 1, 0);

export async function clipRef(name: string, anchor: number, opts: Partial<ClipRef> = {}): Promise<ClipRef> {
  const m = await loadMotion(name);
  return { m, anchor, heading: "hips", ...opts };
}

/** world pose of a clip at clip time t, placed with yaw about +Y then translated */
export function at(c: ClipRef, t: number, yaw = 0, pos: T.Vector3 = V()) {
  const p = sample(c, t);
  return transformPose(p, yaw, pos);
}
/** rotate a world pose about a vertical axis through pivot */
export function rotateAbout(p: MPose, yaw: number, pivot: T.Vector3) {
  const o = clonePose2(p);
  transformPose(o, 0, pivot.clone().setY(0).negate());
  transformPose(o, yaw, pivot.clone().setY(0));
  return o;
}
export function shiftPose(p: MPose, d: T.Vector3) {
  return transformPose(clonePose2(p), 0, d);
}
export { blend };

/** chest facing yaw of a pose (atan2(x,z) of the chest forward) */
export function facing(p: MPose, key: "spine2" | "hips" = "spine2") {
  const f = V(0, 0, 1).applyQuaternion(p.q[key]);
  return Math.atan2(f.x, f.z);
}

export type ShowOpts = { hands?: [HandShape, HandShape]; face?: Face; twist?: number };
export function show(a: Actor, p: MPose, o: ShowOpts = {}) {
  a.root.position.set(0, 0, 0);
  a.root.rotation.set(0, 0, 0);
  a.root.updateMatrixWorld(true);
  applyMPose(a.rig, p, { twist: o.twist ?? 0.5 });
  const [l, r] = o.hands ?? ["fist", "fist"];
  a.rig.hand("l", l, 0.85);
  a.rig.hand("r", r, 0.85);
  setFace(a.rig, o.face ?? {});
}

/** turn neck+head toward a world point (weight 0..1), clamped */
export function lookAt(a: Actor, target: T.Vector3, w = 1, max = 1.1) {
  if (w <= 0) return;
  const r = a.rig;
  for (const [key, share] of [["neck", 0.4], ["head", 1]] as const) {
    const b = r.b(key);
    const bq = b.getWorldQuaternion(new T.Quaternion());
    // Rocketbox head/neck: +Y is the face direction
    const fwd = V(0, 1, 0).applyQuaternion(bq);
    const hp = r.pos("head").add(fwd.clone().multiplyScalar(0.08));
    const want = target.clone().sub(hp).normalize();
    let d = new T.Quaternion().setFromUnitVectors(fwd, want);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(d.w)));
    if (ang > max) d = new T.Quaternion().slerp(d, max / ang);
    d = new T.Quaternion().slerp(d, w * share * (key === "neck" ? 1 : 0.7));
    const goal = d.multiply(bq);
    const pq = b.parent!.getWorldQuaternion(new T.Quaternion());
    b.quaternion.copy(pq.invert().multiply(goal));
    b.updateMatrixWorld(true);
  }
}

/** two-bone IK keeping the end bone's world orientation (feet stay flat, gloves keep their angle) */
export function limbIK(a: Actor, limb: "lArm" | "rArm" | "lLeg" | "rLeg", target: T.Vector3, pole: T.Vector3, w = 1, keepEnd = true) {
  if (w <= 0) return;
  const end = { lArm: "lHand", rArm: "rHand", lLeg: "lFoot", rLeg: "rFoot" }[limb] as "lHand";
  const eb = a.rig.b(end);
  const q = eb.getWorldQuaternion(new T.Quaternion());
  const cur = a.rig.pos(end);
  a.rig.ik(limb, cur.clone().lerp(target, Math.min(1, w)), pole, 1);
  if (keepEnd) {
    const pq = eb.parent!.getWorldQuaternion(new T.Quaternion());
    eb.quaternion.copy(pq.invert().multiply(q));
    eb.updateMatrixWorld(true);
  }
}

/** put the glove's knuckles (≈9 cm past the hand joint along the hand) on a world target */
export function punchContact(a: Actor, side: "l" | "r", target: T.Vector3, pole: T.Vector3, w: number) {
  if (w <= 0) return;
  const r = a.rig;
  for (let i = 0; i < 3; i++) {
    const hand = r.pos(`${side}Hand`);
    const dir = V(1, 0, 0).applyQuaternion(r.b(`${side}Hand`).getWorldQuaternion(new T.Quaternion()));
    const knuckle = hand.clone().addScaledVector(dir, 0.09);
    const goal = hand.clone().add(target.clone().sub(knuckle).multiplyScalar(i === 0 ? w : 1));
    limbIK(a, side === "l" ? "lArm" : "rArm", goal, pole, 1);
    if (w < 1) break;
  }
}

/**
 * Foot locking. Given a deterministic pose function, contacts are detected on the
 * *retargeted* skeleton (ankle low + slow) and each contact is pinned to where it
 * started, with short blends. Removes skating from blends and placement corrections.
 */
export class FootLock {
  spans: { side: "l" | "r"; t0: number; t1: number; anchor: T.Vector3 }[] = [];
  constructor(private a: Actor, poseFn: (t: number) => void, t0: number, t1: number, opts: { hz?: number; h?: number; v?: number } = {}) {
    const hz = opts.hz ?? 60, hMax = opts.h ?? 0.14, vMax = opts.v ?? 0.45;
    const samples: { t: number; l: T.Vector3; r: T.Vector3 }[] = [];
    for (let t = t0; t <= t1 + 1e-6; t += 1 / hz) {
      poseFn(t);
      samples.push({ t, l: a.rig.pos("lFoot"), r: a.rig.pos("rFoot") });
    }
    for (const side of ["l", "r"] as const) {
      let start = -1;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i], p = s[side];
        const q = samples[Math.min(samples.length - 1, i + 1)][side], pr = samples[Math.max(0, i - 1)][side];
        const v = Math.hypot(q.x - pr.x, q.z - pr.z) * hz * 0.5;
        const on = p.y < hMax && v < vMax;
        if (on && start < 0) start = i;
        if ((!on || i === samples.length - 1) && start >= 0) {
          const end = on ? i : i - 1;
          if (samples[end].t - samples[start].t >= 0.12) {
            const k = Math.min(end, start + 2);
            const anchor = samples[start][side].clone().lerp(samples[k][side], 0.5);
            this.spans.push({ side, t0: samples[start].t, t1: samples[end].t, anchor });
          }
          start = -1;
        }
      }
    }
  }
  apply(t: number, fade = 0.07, strength = 1) {
    for (const s of this.spans) {
      if (t < s.t0 - 1e-4 || t > s.t1 + 1e-4) continue;
      const w = Math.min(1, (t - s.t0) / fade + 0.35, (s.t1 - t) / fade + 0.35) * strength;
      const r = this.a.rig;
      const cur = r.pos(`${s.side}Foot`);
      const goal = V(s.anchor.x, cur.y, s.anchor.z);
      const knee = r.pos(`${s.side}Calf`);
      const hip = r.pos(`${s.side}Thigh`);
      // pole: keep the knee's current bend direction
      const mid = hip.clone().lerp(cur, 0.5);
      const pole = knee.clone().add(knee.clone().sub(mid).normalize().multiplyScalar(0.5));
      limbIK(this.a, s.side === "l" ? "lLeg" : "rLeg", goal, pole, Math.max(0, Math.min(1, w)));
    }
  }
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const smooth = (x: number) => x * x * (3 - 2 * x);
export const yawTo = (from: T.Vector3, to: T.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);
export function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
void UP;

/* ---------------- poses built from joint positions (for grappling) ---------------- */
import { emptyPose } from "./retarget";
export type JP = "hips" | "spine" | "chest" | "neck" | "head" | "lClav" | "lSh" | "lEl" | "lWr" | "rClav" | "rSh" | "rEl" | "rWr" | "lHip" | "lKn" | "lAn" | "lToe" | "rHip" | "rKn" | "rAn" | "rToe";
export type Joints = Record<JP, T.Vector3>;
const IDEALD: Record<string, [number, number, number]> = {
  spine: [0, 1, 0], spine1: [0, 1, 0], spine2: [0, 1, 0], neck: [0, 1, 0], head: [0, 1, 0],
  lClav: [1, 0, 0], lUpper: [1, 0, 0], lFore: [1, 0, 0], lHand: [1, 0, 0], rClav: [-1, 0, 0], rUpper: [-1, 0, 0], rFore: [-1, 0, 0], rHand: [-1, 0, 0],
  lThigh: [0, -1, 0], lCalf: [0, -1, 0], lFoot: [0, -0.35, 0.94], lToe: [0, 0, 1], rThigh: [0, -1, 0], rCalf: [0, -1, 0], rFoot: [0, -0.35, 0.94], rToe: [0, 0, 1],
};
function basisQ2(up: T.Vector3, left: T.Vector3) {
  const y = up.clone().normalize();
  const x = left.clone().addScaledVector(y, -left.dot(y)).normalize();
  const z = new T.Vector3().crossVectors(x, y);
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
}
/**
 * Build an MPose (world space) from joint positions given in actor space (+Z forward, +X left),
 * placed with yaw/pos. Each bone gets the minimal swing from the canonical T-pose, with the
 * actor's frame (hips) as twist reference; hands/feet default to following their parent.
 */
export function poseFromJoints(J: Joints, yaw = 0, pos = V(), extra: { lHand?: T.Vector3; rHand?: T.Vector3; head?: T.Quaternion } = {}): MPose {
  const Y = new T.Quaternion().setFromAxisAngle(UP, yaw);
  const w = (v: T.Vector3) => v.clone().applyQuaternion(Y).add(pos);
  const P = {} as Joints;
  for (const k of Object.keys(J) as JP[]) P[k] = w(J[k]);
  const p = emptyPose();
  const hipsQ = basisQ2(P.spine.clone().sub(P.hips), P.lHip.clone().sub(P.rHip));
  p.hips.copy(P.lHip.clone().add(P.rHip).multiplyScalar(0.5));
  p.hipOff.set(0, 0, 0);
  p.legLen = 0.793;
  p.q.hips.copy(hipsQ);
  const chestQ = basisQ2(P.neck.clone().sub(P.chest), P.lSh.clone().sub(P.rSh));
  const sw = (k: string, d: T.Vector3, frame: T.Quaternion) => {
    const ideal = V(...IDEALD[k]).applyQuaternion(frame);
    return new T.Quaternion().setFromUnitVectors(ideal, d.clone().normalize()).multiply(frame);
  };
  p.q.spine.copy(sw("spine", P.chest.clone().sub(P.spine), hipsQ.clone().slerp(chestQ, 0.35)));
  p.q.spine1.copy(sw("spine1", P.chest.clone().sub(P.spine).lerp(P.neck.clone().sub(P.chest), 0.4), hipsQ.clone().slerp(chestQ, 0.7)));
  p.q.spine2.copy(sw("spine2", P.neck.clone().sub(P.chest), chestQ));
  p.q.neck.copy(sw("neck", P.head.clone().sub(P.neck), chestQ));
  p.q.head.copy(extra.head ? extra.head.clone().premultiply(Y) : sw("head", P.head.clone().sub(P.neck), chestQ));
  for (const s of ["l", "r"] as const) {
    p.q[`${s}Clav`].copy(sw(`${s}Clav`, P[`${s}Sh`].clone().sub(P[`${s}Clav`]), chestQ));
    p.q[`${s}Upper`].copy(sw(`${s}Upper`, P[`${s}El`].clone().sub(P[`${s}Sh`]), chestQ));
    p.q[`${s}Fore`].copy(sw(`${s}Fore`, P[`${s}Wr`].clone().sub(P[`${s}El`]), p.q[`${s}Upper`].clone().multiply(new T.Quaternion())));
    const hd = extra[`${s}Hand`];
    p.q[`${s}Hand`].copy(hd ? sw(`${s}Hand`, w(hd).sub(P[`${s}Wr`]), p.q[`${s}Fore`]) : p.q[`${s}Fore`]);
    p.q[`${s}Thigh`].copy(sw(`${s}Thigh`, P[`${s}Kn`].clone().sub(P[`${s}Hip`]), hipsQ));
    p.q[`${s}Calf`].copy(sw(`${s}Calf`, P[`${s}An`].clone().sub(P[`${s}Kn`]), p.q[`${s}Thigh`]));
    p.q[`${s}Foot`].copy(sw(`${s}Foot`, P[`${s}Toe`].clone().sub(P[`${s}An`]), hipsQ));
    p.q[`${s}Toe`].copy(p.q[`${s}Foot`]);
  }
  for (const k of ["lFoot", "rFoot", "lToe", "rToe"] as const) p.feet[k].copy(P[k === "lFoot" ? "lAn" : k === "rFoot" ? "rAn" : k === "lToe" ? "lToe" : "rToe"]);
  return p;
}
