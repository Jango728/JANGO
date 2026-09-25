import * as T from "three";
import { applyPose, lerpPose, loadMocap, samplePose, type J, type Mocap, type Pose, type Rig } from "./rig";
import type { Actor } from "./characters";

/* ------------------------------------------------------------------ *
 * Choreography toolkit: poses are joint positions in metres, in the
 * actor's own space (facing +Z, left = +X, feet on y = 0).
 * ------------------------------------------------------------------ */

export const LEG = 0.793; // our thigh + calf
export const ANKLE_Y = 0.102;
const JOINTS: J[] = ["hips", "spine", "chest", "neck", "head", "lClav", "lSh", "lEl", "lWr", "rClav", "rSh", "rEl", "rWr", "lHip", "lKn", "lAn", "lToe", "rHip", "rKn", "rAn", "rToe"];

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const smooth = (x: number) => x * x * (3 - 2 * x);
export const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
export const easeIn = (x: number) => x * x;
export const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
export const bell = (t: number, c: number, w: number) => Math.exp(-((t - c) * (t - c)) / (2 * w * w));
export const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);

/* ---------- smooth noise for handheld camera and idle sway ---------- */
export function noise1(x: number, seed = 0) {
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}

/* ---------- pose ops ---------- */
export function clonePose(p: Pose): Pose {
  const o = {} as Pose;
  for (const j of JOINTS) o[j] = p[j].clone();
  return o;
}
export function mapPose(p: Pose, fn: (v: T.Vector3, j: J) => T.Vector3): Pose {
  const o = {} as Pose;
  for (const j of JOINTS) o[j] = fn(p[j].clone(), j);
  return o;
}
export function rotatePose(p: Pose, pivot: T.Vector3, axis: T.Vector3, angle: number, only?: J[]) {
  const q = new T.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
  return mapPose(p, (v, j) => (only && !only.includes(j) ? v : v.sub(pivot).applyQuaternion(q).add(pivot)));
}
export function shift(p: Pose, d: T.Vector3, only?: J[], w = 1) {
  return mapPose(p, (v, j) => (only && !only.includes(j) ? v : v.addScaledVector(d, w)));
}
export const UPPER: J[] = ["spine", "chest", "neck", "head", "lClav", "lSh", "lEl", "lWr", "rClav", "rSh", "rEl", "rWr"];
export const HEADSET: J[] = ["neck", "head"];
export const ARM_L: J[] = ["lEl", "lWr"];
export const ARM_R: J[] = ["rEl", "rWr"];

/** blend a subset of joints from b over a */
export function blendJoints(a: Pose, b: Pose, joints: J[], w: number) {
  if (w <= 0) return a;
  const o = clonePose(a);
  for (const j of joints) o[j].lerp(b[j], clamp(w));
  return o;
}

/** place an arm by explicit elbow/wrist positions (actor space) */
export function setArm(p: Pose, side: "l" | "r", el: T.Vector3, wr: T.Vector3, w = 1) {
  const o = clonePose(p);
  o[`${side}El`].lerp(el, w);
  o[`${side}Wr`].lerp(wr, w);
  return o;
}

/** two-bone solve in pose space: elbow from shoulder, wrist target and a pole */
export function armTo(p: Pose, side: "l" | "r", wrist: T.Vector3, pole: T.Vector3, w = 1, l1 = 0.29, l2 = 0.27) {
  const sh = p[`${side}Sh`];
  const d = Math.min(wrist.distanceTo(sh), (l1 + l2) * 0.999);
  const dir = wrist.clone().sub(sh).normalize();
  const tgt = sh.clone().addScaledVector(dir, d);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pd = pole.clone().sub(sh);
  pd.addScaledVector(dir, -pd.dot(dir)).normalize();
  const el = sh.clone().addScaledVector(dir, cosA * l1).addScaledVector(pd, sinA * l1);
  return setArm(p, side, el, tgt, w);
}
export function legTo(p: Pose, side: "l" | "r", ankle: T.Vector3, pole: T.Vector3, w = 1, toeFwd?: T.Vector3) {
  const hp = p[`${side}Hip`];
  const l1 = 0.398, l2 = 0.395;
  const d = Math.min(ankle.distanceTo(hp), (l1 + l2) * 0.999);
  const dir = ankle.clone().sub(hp).normalize();
  const tgt = hp.clone().addScaledVector(dir, d);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pd = pole.clone().sub(hp);
  pd.addScaledVector(dir, -pd.dot(dir)).normalize();
  const kn = hp.clone().addScaledVector(dir, cosA * l1).addScaledVector(pd, sinA * l1);
  const o = clonePose(p);
  o[`${side}Kn`].lerp(kn, w);
  const toeOff = o[`${side}Toe`].clone().sub(o[`${side}An`]);
  o[`${side}An`].lerp(tgt, w);
  o[`${side}Toe`].copy(o[`${side}An`]).add(toeFwd ? toeFwd.clone().multiplyScalar(0.14) : toeOff);
  return o;
}

/* ---------- mocap access ---------- */
export type Clip = { mc: Mocap; k: number; yaw: number; trend: boolean };
const clips = new Map<string, Clip>();
/**
 * Load a clip, scaled to our leg length and rotated so that its travel (or
 * a supplied facing) points down +Z. trend=true removes forward progress.
 */
export async function clip(name: string, opts: { yaw?: number; trend?: boolean } = {}) {
  const key = name + JSON.stringify(opts);
  if (clips.has(key)) return clips.get(key)!;
  const mc = await loadMocap(`bvh/${name}.bvh`);
  const a = mc.pos[0].hips, b = mc.pos[mc.frames - 1].hips;
  const travel = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = opts.yaw ?? (travel > 1 ? Math.atan2(b.x - a.x, b.z - a.z) : 0);
  const c = { mc, k: LEG / mc.legLen, yaw, trend: opts.trend ?? travel > 1 };
  clips.set(key, c);
  return c;
}
const _q = new T.Quaternion(), _up = new T.Vector3(0, 1, 0);
/** sample a clip at time t (seconds, clip time), in place */
export function at(c: Clip, t: number): Pose {
  const { mc, k, yaw, trend } = c;
  const tt = clamp(t, 0, mc.duration - 1 / mc.fps);
  const p = samplePose(mc, tt);
  let ox = 0, oz = 0;
  if (trend) {
    const a = mc.pos[0].hips, b = mc.pos[mc.frames - 1].hips, u = tt / mc.duration;
    ox = a.x + (b.x - a.x) * u;
    oz = a.z + (b.z - a.z) * u;
  } else {
    ox = mc.pos[0].hips.x;
    oz = mc.pos[0].hips.z;
  }
  _q.setFromAxisAngle(_up, -yaw);
  return mapPose(p, (v) => v.set(v.x - ox, v.y, v.z - oz).applyQuaternion(_q).multiplyScalar(k));
}
/** forward speed of a locomotion clip in m/s (after scaling) */
export function speed(c: Clip) {
  const a = c.mc.pos[0].hips, b = c.mc.pos[c.mc.frames - 1].hips;
  return (Math.hypot(b.x - a.x, b.z - a.z) * c.k) / c.mc.duration;
}
/** loop a region [a,b] with a crossfade */
export function loop(c: Clip, t: number, a: number, b: number, fade = 0.3): Pose {
  const L = b - a - fade;
  const u = ((t % L) + L) % L;
  const p = at(c, a + fade + u);
  if (u > L - fade) {
    const w = (u - (L - fade)) / fade;
    return lerpPose(p, at(c, a + (u - (L - fade))), smooth(w));
  }
  return p;
}
/** ping-pong a region with eased turnarounds (for stances) */
export function pingpong(c: Clip, t: number, a: number, b: number, period: number) {
  const x = 0.5 - 0.5 * Math.cos((t / period) * Math.PI);
  return at(c, a + (b - a) * x);
}

/* ---------- putting a pose on an actor ---------- */
export type Face = { jaw?: number; tongue?: number; brow?: number; browIn?: number; smile?: number; eyes?: number; cheeks?: number };
export type HandShape = "fist" | "relaxed" | "open" | "bird" | "spread";

export function place(a: Actor, pos: T.Vector3, yaw: number) {
  a.root.position.copy(pos);
  a.root.rotation.set(0, yaw, 0);
  a.root.updateMatrixWorld(true);
}
export function pose(a: Actor, p: Pose, opts: { hands?: [HandShape, HandShape]; face?: Face; ground?: number; head?: [number, number, number] } = {}) {
  applyPose(a.rig, p, { hipScale: 1 });
  if (opts.ground) groundFeet(a, opts.ground);
  if (opts.head) turnHead(a.rig, ...opts.head);
  const [l, r] = opts.hands ?? ["fist", "fist"];
  a.rig.hand("l", l);
  a.rig.hand("r", r);
  face(a.rig, opts.face ?? {});
}
/** extra head rotation in character space: yaw (turn left +), pitch (nod down +), roll */
export function turnHead(r: Rig, yaw: number, pitch: number, roll: number) {
  const q = new T.Quaternion().setFromEuler(new T.Euler(pitch, yaw, roll, "YXZ"));
  const cur = r.worldQ("head");
  r.setWorldQ("head", q.multiply(cur));
}
/** knuckle-accurate punch: put the front of the fist (≈10.5 cm past the hand joint) on a world target */
export function punchIK(a: Actor, side: "l" | "r", target: T.Vector3, pole: T.Vector3, w: number) {
  const r = a.rig;
  for (let i = 0; i < 3; i++) {
    const hand = r.pos(`${side}Hand`);
    const dir = new T.Vector3(1, 0, 0).applyQuaternion(r.b(`${side}Hand`).getWorldQuaternion(new T.Quaternion()));
    const knuckle = hand.clone().addScaledVector(dir, 0.105);
    const goal = hand.clone().add(target.clone().sub(knuckle));
    r.ik(side === "l" ? "lArm" : "rArm", goal, pole, i === 0 ? w : 1);
    if (w < 1) break;
  }
}
/** move the root so the lower ankle sits at the rest ankle height (w = 0..1) */
export function groundFeet(a: Actor, w = 1) {
  const r = a.rig;
  const y = Math.min(r.pos("lFoot").y, r.pos("rFoot").y) - a.root.position.y;
  const root = r.bones["Bip01"];
  root.position.y += ((ANKLE_Y - y) * w) / 0.01;
  root.updateMatrixWorld(true);
}

/* ---------- facial rig (Rocketbox Bip01 face bones; head space: +X up, +Y front, Z side) ---------- */
const FB = {
  jaw: "Bip01_MJaw", tongue: "Bip01_MTongue",
  lBrowIn: "Bip01_LInnerEyebrow", rBrowIn: "Bip01_RInnerEyebrow", lBrowOut: "Bip01_LOuterEyebrow", rBrowOut: "Bip01_ROuterEyebrow", browMid: "Bip01_MMiddleEyebrow",
  lCorner: "Bip01_LMouthCorner", rCorner: "Bip01_RMouthCorner", lCheek: "Bip01_LCheek", rCheek: "Bip01_RCheek",
  lLidTop: "Bip01_LEyeBlinkTop", rLidTop: "Bip01_REyeBlinkTop", lLidBot: "Bip01_LEyeBlinkBottom", rLidBot: "Bip01_REyeBlinkBottom",
  upperLip: "Bip01_MUpperLip", lowerLip: "Bip01_MBottomLip",
};
function nudge(r: Rig, name: string, head: T.Vector3) {
  const b = r.bones[name];
  if (!b) return;
  const hb = r.bones["Bip01_Head"];
  // express the head-space offset in the bone's parent space
  const hq = hb.getWorldQuaternion(new T.Quaternion());
  const pq = b.parent!.getWorldQuaternion(new T.Quaternion());
  const v = head.clone().applyQuaternion(hq).applyQuaternion(pq.invert());
  const ps = b.parent!.getWorldScale(new T.Vector3()).x / hb.getWorldScale(new T.Vector3()).x;
  b.position.copy(r.restPos.get(b)!).addScaledVector(v, 1 / ps);
}
export function face(r: Rig, f: Face) {
  r.group.updateMatrixWorld(true);
  const jaw = r.bones[FB.jaw];
  if (jaw && f.jaw) {
    jaw.quaternion.copy(r.restLocal.get(jaw)!).multiply(new T.Quaternion().setFromAxisAngle(V(0, 0, 1), -(f.jaw ?? 0) * 0.5));
    jaw.updateMatrixWorld(true);
  }
  if (f.tongue) nudge(r, FB.tongue, V(-0.6 * f.tongue, 4.2 * f.tongue, 0));
  const b = f.brow ?? 0, bi = f.browIn ?? 0;
  nudge(r, FB.lBrowIn, V(0.55 * b - 0.35 * bi, 0, -0.3 * bi));
  nudge(r, FB.rBrowIn, V(0.55 * b - 0.35 * bi, 0, 0.3 * bi));
  nudge(r, FB.browMid, V(0.5 * b - 0.3 * bi, 0, 0));
  nudge(r, FB.lBrowOut, V(0.45 * b, 0, 0));
  nudge(r, FB.rBrowOut, V(0.45 * b, 0, 0));
  const s = f.smile ?? 0;
  nudge(r, FB.lCorner, V(0.35 * s, -0.1 * Math.abs(s), 0.45 * Math.max(0, s)));
  nudge(r, FB.rCorner, V(0.35 * s, -0.1 * Math.abs(s), -0.45 * Math.max(0, s)));
  const ch = f.cheeks ?? Math.max(0, s) * 0.6;
  nudge(r, FB.lCheek, V(0.3 * ch, 0.15 * ch, 0.1 * ch));
  nudge(r, FB.rCheek, V(0.3 * ch, 0.15 * ch, -0.1 * ch));
  // eyes: 1 = wide, 0 = normal, -1 = closed
  const e = f.eyes ?? 0;
  const top = e >= 0 ? 0.25 * e : 0.55 * e, bot = e >= 0 ? -0.12 * e : -0.18 * e;
  nudge(r, FB.lLidTop, V(top, 0, 0));
  nudge(r, FB.rLidTop, V(top, 0, 0));
  nudge(r, FB.lLidBot, V(bot, 0, 0));
  nudge(r, FB.rLidBot, V(bot, 0, 0));
}

/* ---------- camera ---------- */
export type Shot = { start: number; end: number; eval: (u: number, t: number) => { pos: T.Vector3; look: T.Vector3; fov: number }; shake?: number };
export function applyShots(cam: T.PerspectiveCamera, shots: Shot[], t: number, extraShake = 0) {
  const s = shots.find((x) => t >= x.start && t < x.end) ?? shots[shots.length - 1];
  const u = clamp((t - s.start) / (s.end - s.start));
  const { pos, look, fov } = s.eval(u, t);
  const sh = (s.shake ?? 0.012) + extraShake;
  const n = V(noise1(t * 1.3, 1), noise1(t * 1.1, 2), noise1(t * 1.2, 3)).multiplyScalar(sh);
  const n2 = V(noise1(t * 1.7, 4), noise1(t * 1.5, 5), 0).multiplyScalar(sh * 0.6);
  cam.position.copy(pos).add(n);
  cam.lookAt(look.clone().add(n2));
  cam.fov = fov;
  cam.updateProjectionMatrix();
  return s;
}
export const lerpV = (a: T.Vector3, b: T.Vector3, u: number) => a.clone().lerp(b, u);

/** actor-space → world helper */
export function toWorld(pos: T.Vector3, yaw: number, local: T.Vector3) {
  return local.clone().applyAxisAngle(_up, yaw).add(pos);
}
export function toLocal(pos: T.Vector3, yaw: number, world: T.Vector3) {
  return world.clone().sub(pos).applyAxisAngle(_up, -yaw);
}
export const yawTo = (from: T.Vector3, to: T.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);
