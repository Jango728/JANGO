import * as T from "three";
import type { Rig } from "./rig";

/* ------------------------------------------------------------------ *
 * Rotation-based retargeting (replaces the old joint-position puppet).
 *
 * Motions are pre-converted offline by tools/convert_bvh.py into
 * per-joint world-space delta rotations D(t) relative to a canonical
 * T-pose. Here the Rocketbox bind pose is aligned to the same canonical
 * T-pose once (QtRef) and every frame each bone gets
 *     world(bone) = D(t) * QtRef(bone)
 * so the full 3-DoF rotation (incl. forearm roll / head / foot) is kept
 * and bone lengths never change: no stretching, no flailing.
 * ------------------------------------------------------------------ */

export const KEYS = ["hips", "spine", "spine1", "spine2", "neck", "head", "lClav", "lUpper", "lFore", "lHand", "rClav", "rUpper", "rFore", "rHand", "lThigh", "lCalf", "lFoot", "lToe", "rThigh", "rCalf", "rFoot", "rToe"] as const;
export type Key = (typeof KEYS)[number];
const BONE: Record<Key, string> = {
  hips: "Bip01_Pelvis", spine: "Bip01_Spine", spine1: "Bip01_Spine1", spine2: "Bip01_Spine2", neck: "Bip01_Neck", head: "Bip01_Head",
  lClav: "Bip01_L_Clavicle", lUpper: "Bip01_L_UpperArm", lFore: "Bip01_L_Forearm", lHand: "Bip01_L_Hand",
  rClav: "Bip01_R_Clavicle", rUpper: "Bip01_R_UpperArm", rFore: "Bip01_R_Forearm", rHand: "Bip01_R_Hand",
  lThigh: "Bip01_L_Thigh", lCalf: "Bip01_L_Calf", lFoot: "Bip01_L_Foot", lToe: "Bip01_L_Toe0",
  rThigh: "Bip01_R_Thigh", rCalf: "Bip01_R_Calf", rFoot: "Bip01_R_Foot", rToe: "Bip01_R_Toe0",
};
const CHILD: Partial<Record<Key, Key>> = { spine: "spine1", spine1: "spine2", spine2: "neck", neck: "head", lClav: "lUpper", lUpper: "lFore", lFore: "lHand", rClav: "rUpper", rUpper: "rFore", rFore: "rHand", lThigh: "lCalf", lCalf: "lFoot", lFoot: "lToe", rThigh: "rCalf", rCalf: "rFoot", rFoot: "rToe" };
// canonical directions (same table as the converter)
const IDEAL: Record<Key, [number, number, number]> = {
  hips: [0, 1, 0], spine: [0, 1, 0], spine1: [0, 1, 0], spine2: [0, 1, 0], neck: [0, 1, 0], head: [0, 1, 0],
  lClav: [1, 0, 0], lUpper: [1, 0, 0], lFore: [1, 0, 0], lHand: [1, 0, 0], rClav: [-1, 0, 0], rUpper: [-1, 0, 0], rFore: [-1, 0, 0], rHand: [-1, 0, 0],
  lThigh: [0, -1, 0], lCalf: [0, -1, 0], lFoot: [0, -0.35, 0.94], lToe: [0, 0, 1], rThigh: [0, -1, 0], rCalf: [0, -1, 0], rFoot: [0, -0.35, 0.94], rToe: [0, 0, 1],
};
const MIRROR: Record<Key, Key> = {} as any;
for (const k of KEYS) MIRROR[k] = (k[0] === "l" && k[1] === k[1].toUpperCase() ? "r" + k.slice(1) : k[0] === "r" && k[1] === k[1].toUpperCase() ? "l" + k.slice(1) : k) as Key;

export type Motion = { headPitch: number; name: string; fps: number; frames: number; duration: number; stride: number; data: Float32Array; legLen: number; hipOff: T.Vector3 };
const cache = new Map<string, Promise<Motion>>();
export function loadMotion(name: string) {
  if (!cache.has(name))
    cache.set(
      name,
      (async () => {
        const hdr = await (await fetch(`mo/${name}.json`)).json();
        const buf = await (await fetch(`mo/${name}.bin`)).arrayBuffer();
        const hp = +(new URLSearchParams(location.search).get("headpitch") ?? 0.3);
        // the CMU boxing subjects (13, 14) hold the chin up relative to their T-pose frame: level it for a fighter's chin-down look
        return { headPitch: /^cmu_1[34]_/.test(name) ? hp : 0, name, fps: hdr.fps, frames: hdr.frames, duration: (hdr.frames - 1) / hdr.fps, stride: hdr.stride, data: new Float32Array(buf), legLen: hdr.legLen, hipOff: new T.Vector3().fromArray(hdr.hipOff) } as Motion;
      })(),
    );
  return cache.get(name)!;
}

/** A pose in actor space (+Z forward, +X left, metres, source scale). */
export type MPose = { hips: T.Vector3; q: Record<Key, T.Quaternion>; feet: Record<"lFoot" | "rFoot" | "lToe" | "rToe", T.Vector3>; hipOff: T.Vector3; legLen: number };

const _q = new T.Quaternion(), _q2 = new T.Quaternion(), _v = new T.Vector3(), _up = new T.Vector3(0, 1, 0), _xAxis = new T.Vector3(1, 0, 0);

function readFrame(m: Motion, f: number, out: MPose) {
  const d = m.data, o = f * m.stride;
  out.hips.set(d[o], d[o + 1], d[o + 2]);
  let c = o + 3;
  for (const k of KEYS) {
    out.q[k].set(d[c], d[c + 1], d[c + 2], d[c + 3]);
    c += 4;
  }
  for (const k of ["lFoot", "rFoot", "lToe", "rToe"] as const) {
    out.feet[k].set(d[c], d[c + 1], d[c + 2]);
    c += 3;
  }
}
export function emptyPose(): MPose {
  const q = {} as Record<Key, T.Quaternion>;
  for (const k of KEYS) q[k] = new T.Quaternion();
  return { hips: new T.Vector3(), q, feet: { lFoot: new T.Vector3(), rFoot: new T.Vector3(), lToe: new T.Vector3(), rToe: new T.Vector3() }, hipOff: new T.Vector3(), legLen: 0.859 };
}
export function clonePose2(p: MPose): MPose {
  const o = emptyPose();
  o.hips.copy(p.hips);
  for (const k of KEYS) o.q[k].copy(p.q[k]);
  for (const k of Object.keys(p.feet) as (keyof MPose["feet"])[]) o.feet[k].copy(p.feet[k]);
  o.hipOff.copy(p.hipOff);
  o.legLen = p.legLen;
  return o;
}
const A = emptyPose(), Bp = emptyPose();

/** heading (yaw about +Y, 0 = facing +Z) of a hips rotation */
export function headingOf(q: T.Quaternion) {
  const f = new T.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}

export type ClipRef = { m: Motion; mirror?: boolean; anchor?: number; heading?: number | "hips" | "feet" | "none"; start?: number; /** target leg length (m): output is scaled to it */ leg?: number };
/** Normalisation of a clip: rotation/translation that puts the anchor frame at the origin facing +Z. */
type Norm = { rot: T.Quaternion; off: T.Vector3 };
const normCache = new WeakMap<ClipRef, Norm>();
function rawSample(c: ClipRef, t: number, out: MPose) {
  const m = c.m;
  const f = Math.max(0, Math.min(m.frames - 1.0001, t * m.fps));
  const i = Math.floor(f), a = f - i;
  readFrame(m, i, A);
  readFrame(m, i + 1, Bp);
  out.hips.lerpVectors(A.hips, Bp.hips, a);
  for (const k of KEYS) out.q[k].slerpQuaternions(A.q[k], Bp.q[k], a);
  for (const k of Object.keys(out.feet) as (keyof MPose["feet"])[]) out.feet[k].lerpVectors(A.feet[k], Bp.feet[k], a);
  out.hipOff.copy(m.hipOff);
  out.legLen = m.legLen;
  // CMU T-pose frames carry a pitched-down head; compensate so a neutral head looks level
  if (m.headPitch) {
    out.q.neck.multiply(_q2.setFromAxisAngle(_xAxis, m.headPitch * 0.35));
    out.q.head.multiply(_q2.setFromAxisAngle(_xAxis, m.headPitch));
  }
  if (c.mirror) mirrorInPlace(out);
}
export function mirrorInPlace(p: MPose) {
  const q = {} as Record<Key, T.Quaternion>;
  for (const k of KEYS) {
    const s = p.q[MIRROR[k]];
    q[k] = new T.Quaternion(s.x, -s.y, -s.z, s.w);
  }
  for (const k of KEYS) p.q[k].copy(q[k]);
  p.hips.x *= -1;
  const lf = p.feet.lFoot.clone(), lt = p.feet.lToe.clone();
  p.feet.lFoot.copy(p.feet.rFoot).x *= -1;
  p.feet.lToe.copy(p.feet.rToe).x *= -1;
  p.feet.rFoot.copy(lf).x *= -1;
  p.feet.rToe.copy(lt).x *= -1;
  p.hipOff.x *= -1;
}
function norm(c: ClipRef): Norm {
  let n = normCache.get(c);
  if (n) return n;
  const p = emptyPose();
  rawSample(c, c.anchor ?? 0, p);
  let h = 0;
  if (c.heading === "hips" || c.heading === undefined) h = headingOf(p.q.hips);
  else if (c.heading === "feet") {
    // facing = perpendicular to the line between the feet, toward the toes
    const l = p.feet.lFoot.clone().sub(p.feet.rFoot).setY(0).normalize();
    const fwd = new T.Vector3().crossVectors(l, _up);
    h = Math.atan2(fwd.x, fwd.z);
  } else if (typeof c.heading === "number") h = c.heading;
  const rot = new T.Quaternion().setFromAxisAngle(_up, -h);
  const off = p.hips.clone().setY(0).applyQuaternion(rot).negate();
  n = { rot, off };
  normCache.set(c, n);
  return n;
}
/** Sample a clip at clip time t (seconds) in actor space. */
export function sample(c: ClipRef, t: number, out = emptyPose()): MPose {
  rawSample(c, t, out);
  const n = norm(c);
  out.hips.applyQuaternion(n.rot).add(n.off);
  for (const k of KEYS) out.q[k].premultiply(n.rot);
  for (const k of Object.keys(out.feet) as (keyof MPose["feet"])[]) out.feet[k].applyQuaternion(n.rot).add(n.off);
  // scale into the target's size
  const leg = c.leg ?? 0.793, k = leg / out.legLen;
  out.hips.multiplyScalar(k);
  for (const f of Object.keys(out.feet) as (keyof MPose["feet"])[]) out.feet[f].multiplyScalar(k);
  out.hipOff.multiplyScalar(k);
  out.legLen = leg;
  return out;
}
/** Blend b over a (w in 0..1); optional joint subset. Returns a new pose. */
export function blend(a: MPose, b: MPose, w: number, only?: readonly Key[]): MPose {
  const o = clonePose2(a);
  if (w <= 0) return o;
  if (!only) {
    o.hips.lerp(b.hips, w);
    for (const k of Object.keys(o.feet) as (keyof MPose["feet"])[]) o.feet[k].lerp(b.feet[k], w);
  }
  for (const k of only ?? KEYS) o.q[k].slerp(b.q[k], Math.min(1, w));
  return o;
}
/** rotate a whole pose about +Y by yaw and translate (actor space edit) */
export function transformPose(p: MPose, yaw: number, off: T.Vector3) {
  const r = new T.Quaternion().setFromAxisAngle(_up, yaw);
  p.hips.applyQuaternion(r).add(off);
  for (const k of KEYS) p.q[k].premultiply(r);
  for (const k of Object.keys(p.feet) as (keyof MPose["feet"])[]) p.feet[k].applyQuaternion(r).add(off);
  return p;
}

/* ---------------------------- target side ---------------------------- */
type Target = { ref: Record<Key, T.Quaternion>; tOff: T.Vector3; leg: number; bones: Record<Key, T.Bone>; root: T.Bone };
const targets = new WeakMap<Rig, Target>();

function swing(from: T.Vector3, to: T.Vector3) {
  return new T.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
}
function basisQ(up: T.Vector3, left: T.Vector3) {
  const y = up.clone().normalize();
  const x = left.clone().addScaledVector(y, -left.dot(y)).normalize();
  const z = new T.Vector3().crossVectors(x, y);
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
}

export function target(rig: Rig): Target {
  let t = targets.get(rig);
  if (t) return t;
  rig.reset();
  const g = rig.group;
  g.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(g.matrixWorld).invert();
  const P = {} as Record<Key, T.Vector3>, Q = {} as Record<Key, T.Quaternion>, bones = {} as Record<Key, T.Bone>;
  const m = new T.Matrix4(), s = new T.Vector3();
  for (const k of KEYS) {
    const b = rig.bones[BONE[k]];
    bones[k] = b;
    m.multiplyMatrices(inv, b.matrixWorld);
    P[k] = new T.Vector3();
    Q[k] = new T.Quaternion();
    m.decompose(P[k], Q[k], s);
    P[k].multiplyScalar(0.01); // metres (group is cm)
  }
  const ref = {} as Record<Key, T.Quaternion>;
  const thighMid = P.lThigh.clone().add(P.rThigh).multiplyScalar(0.5);
  let corrHips = new T.Quaternion();
  for (const k of KEYS) {
    if (k === "hips") {
      const up = P.spine.clone().sub(P.hips), left = P.lThigh.clone().sub(P.rThigh);
      corrHips = basisQ(up, left).invert();
      ref[k] = corrHips.clone().multiply(Q[k]);
      continue;
    }
    const c = CHILD[k];
    const d = c ? P[c].clone().sub(P[k]) : new T.Vector3(1, 0, 0).applyQuaternion(Q[k]);
    ref[k] = swing(d, new T.Vector3(...IDEAL[k])).multiply(Q[k]);
  }
  const tOff = thighMid.clone().sub(P.hips).applyQuaternion(corrHips);
  const leg = P.lThigh.distanceTo(P.lCalf) + P.lCalf.distanceTo(P.lFoot);
  t = { ref, tOff, leg, bones, root: rig.bones["Bip01"] };
  targets.set(rig, t);
  return t;
}

const _m = new T.Matrix4(), _pq = new T.Quaternion(), _gq = new T.Quaternion();
/** set bone world orientation in group space */
function setGroupQ(rig: Rig, b: T.Bone, q: T.Quaternion) {
  // parent orientation in group space
  const gInv = _m.copy(rig.group.matrixWorld).invert();
  const pm = new T.Matrix4().multiplyMatrices(gInv, b.parent!.matrixWorld);
  pm.decompose(_v, _pq, new T.Vector3());
  b.quaternion.copy(_pq.invert().multiply(q)).normalize();
  b.updateMatrixWorld(true);
}
/**
 * Pose a rig from an actor-space MPose. The actor root must already be placed.
 * twist: fraction of the hand's roll moved into the forearm (no twist bones on Rocketbox).
 */
export function applyMPose(rig: Rig, p: MPose, opts: { twist?: number } = {}) {
  const t = target(rig);
  rig.reset();
  rig.group.updateMatrixWorld(true);
  const k = t.leg / p.legLen;
  // root: put the target thigh centre where the (scaled) source thigh centre is
  const srcMid = p.hips.clone().add(p.hipOff.clone().applyQuaternion(p.q.hips)).multiplyScalar(k);
  const hipsQ = p.q.hips.clone().multiply(t.ref.hips);
  // tOff is in the canonical frame: world offset = D * tOff
  const pelvis = srcMid.sub(t.tOff.clone().applyQuaternion(p.q.hips));
  // Bip01 local position (parent is the group or an identity node) in cm
  const root = t.root;
  const pInv = new T.Matrix4().multiplyMatrices(_m.copy(rig.group.matrixWorld).invert(), root.parent!.matrixWorld).invert();
  root.position.copy(pelvis.multiplyScalar(100).applyMatrix4(pInv));
  root.updateMatrixWorld(true);
  setGroupQ(rig, t.bones.hips, hipsQ);
  for (const key of KEYS) {
    if (key === "hips") continue;
    setGroupQ(rig, t.bones[key], _gq.copy(p.q[key]).multiply(t.ref[key]));
  }
  // distribute hand roll into the forearm
  const tw = opts.twist ?? 0.5;
  for (const s of ["l", "r"] as const) {
    const fore = t.bones[`${s}Fore`], hand = t.bones[`${s}Hand`];
    const lq = hand.quaternion;
    // swing-twist about local X
    const twist = new T.Quaternion(lq.x, 0, 0, lq.w).normalize();
    const part = new T.Quaternion().slerp(twist, tw);
    fore.quaternion.multiply(part);
    hand.quaternion.premultiply(part.clone().invert());
    fore.updateMatrixWorld(true);
  }
  return k;
}
export { BONE };
