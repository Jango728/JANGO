import * as T from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { BVHLoader } from "three/addons/loaders/BVHLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

/* ------------------------------------------------------------------ *
 * Rocketbox character loading + a positional puppet rig.
 * Units: metres. Character faces +Z at yaw 0.
 * ------------------------------------------------------------------ */

const texLoader = new T.TextureLoader();
const texCache = new Map<string, T.Texture>();
const texPending: Promise<unknown>[] = [];
/** resolves when every texture requested so far has finished loading */
export function texReady() {
  return Promise.all(texPending);
}
export function tex(url: string, srgb = true) {
  if (!texCache.has(url)) {
    let done: (v?: unknown) => void = () => {};
    texPending.push(new Promise((r) => (done = r)));
    const t = texLoader.load(url, () => done(), undefined, () => done());
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    t.anisotropy = 8;
    texCache.set(url, t);
  }
  return texCache.get(url)!;
}

const fbxCache = new Map<string, Promise<T.Group>>();
function loadFbx(url: string) {
  if (!fbxCache.has(url)) fbxCache.set(url, new FBXLoader().loadAsync(url));
  return fbxCache.get(url)!;
}

export type Look = {
  fbx: string;
  maps: Record<string, { color: string | T.Texture; normal?: string; rough?: number; sheen?: number }>;
  tint?: T.ColorRepresentation;
};

export async function loadCharacter(look: Look) {
  const src = await loadFbx(look.fbx);
  const g = cloneSkinned(src) as T.Group;
  g.traverse((o) => {
    const m = o as T.SkinnedMesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((old) => {
      const key = Object.keys(look.maps).find((k) => old.name.toLowerCase().includes(k)) ?? Object.keys(look.maps)[0];
      const spec = look.maps[key];
      const map = typeof spec.color === "string" ? tex(spec.color) : spec.color;
      const mat = new T.MeshPhysicalMaterial({
        name: old.name,
        map,
        normalMap: spec.normal ? tex(spec.normal, false) : null,
        roughness: spec.rough ?? 0.62,
        metalness: 0,
        sheen: spec.sheen ?? 0.25,
        sheenRoughness: 0.6,
        sheenColor: new T.Color("#ffd9c4"),
        clearcoat: 0.08,
        clearcoatRoughness: 0.5,
        transparent: /hair|opacity/i.test(old.name),
        alphaTest: /hair|opacity/i.test(old.name) ? 0.4 : 0,
        side: /hair|opacity/i.test(old.name) ? T.DoubleSide : T.FrontSide,
      });
      if (look.tint) mat.color = new T.Color(look.tint);
      return mat;
    });
    m.material = mats.length === 1 ? mats[0] : mats;
  });
  g.scale.setScalar(0.01);
  return g;
}

/* ------------------------------ Rig ------------------------------ */

export const B = {
  root: "Bip01",
  pelvis: "Bip01_Pelvis",
  spine: "Bip01_Spine",
  spine1: "Bip01_Spine1",
  spine2: "Bip01_Spine2",
  neck: "Bip01_Neck",
  head: "Bip01_Head",
  jaw: "Bip01_MJaw",
  lClav: "Bip01_L_Clavicle",
  lUpper: "Bip01_L_UpperArm",
  lFore: "Bip01_L_Forearm",
  lHand: "Bip01_L_Hand",
  rClav: "Bip01_R_Clavicle",
  rUpper: "Bip01_R_UpperArm",
  rFore: "Bip01_R_Forearm",
  rHand: "Bip01_R_Hand",
  lThigh: "Bip01_L_Thigh",
  lCalf: "Bip01_L_Calf",
  lFoot: "Bip01_L_Foot",
  lToe: "Bip01_L_Toe0",
  rThigh: "Bip01_R_Thigh",
  rCalf: "Bip01_R_Calf",
  rFoot: "Bip01_R_Foot",
  rToe: "Bip01_R_Toe0",
} as const;
export type BoneKey = keyof typeof B;

const _v = new T.Vector3(), _v2 = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _m = new T.Matrix4();

export class Rig {
  group: T.Group;
  bones: Record<string, T.Bone> = {};
  restLocal = new Map<T.Bone, T.Quaternion>();
  restPos = new Map<T.Bone, T.Vector3>();
  restWorldQ = new Map<string, T.Quaternion>();
  restDir = new Map<string, T.Vector3>();
  order: T.Bone[] = [];
  hipHeight = 0.895;

  constructor(group: T.Group) {
    this.group = group;
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if ((o as T.Bone).isBone) {
        const b = o as T.Bone;
        this.bones[b.name] = b;
        this.restLocal.set(b, b.quaternion.clone());
        this.restPos.set(b, b.position.clone());
        this.order.push(b);
      }
    });
    // world rest orientations relative to the character root (yaw 0, at origin)
    const inv = new T.Matrix4().copy(group.matrixWorld).invert();
    for (const [key, name] of Object.entries(B)) {
      const b = this.bones[name];
      if (!b) continue;
      _m.multiplyMatrices(inv, b.matrixWorld);
      const q = new T.Quaternion();
      _m.decompose(_v, q, _v2);
      this.restWorldQ.set(key, q);
      this.restDir.set(key, new T.Vector3(1, 0, 0).applyQuaternion(q));
    }
  }
  b(key: BoneKey) {
    return this.bones[B[key]];
  }
  reset() {
    for (const b of this.order) {
      b.quaternion.copy(this.restLocal.get(b)!);
      b.position.copy(this.restPos.get(b)!);
    }
  }
  /** character-space world quaternion of a bone (character root excluded) */
  worldQ(key: BoneKey, out = new T.Quaternion()) {
    const b = this.b(key);
    this.group.updateMatrixWorld(true);
    out.setFromRotationMatrix(_m.copy(this.group.matrixWorld).invert().multiply(b.matrixWorld));
    return out.normalize();
  }
  /** set a bone's orientation in character space */
  setWorldQ(key: BoneKey, q: T.Quaternion) {
    const b = this.b(key), p = b.parent!;
    this.group.updateMatrixWorld(true);
    const parentQ = new T.Quaternion().setFromRotationMatrix(_m.copy(this.group.matrixWorld).invert().multiply(p.matrixWorld)).normalize();
    b.quaternion.copy(parentQ.invert().multiply(q)).normalize();
    b.updateMatrixWorld(true);
  }
  /** position of a bone in scene (world) space */
  pos(key: BoneKey, out = new T.Vector3()) {
    this.group.updateMatrixWorld(true);
    return this.b(key).getWorldPosition(out);
  }
  /** turn a bone so its along-bone axis (+X) points at a world-space target, keeping twist minimal */
  aim(key: BoneKey, target: T.Vector3, weight = 1) {
    const b = this.b(key);
    this.group.updateMatrixWorld(true);
    const from = b.getWorldPosition(new T.Vector3());
    const dirW = target.clone().sub(from).normalize();
    const cur = new T.Quaternion();
    b.getWorldQuaternion(cur);
    const axis = new T.Vector3(1, 0, 0).applyQuaternion(cur);
    const delta = new T.Quaternion().setFromUnitVectors(axis, dirW);
    const goalW = delta.multiply(cur);
    const parentW = new T.Quaternion();
    b.parent!.getWorldQuaternion(parentW);
    const local = parentW.invert().multiply(goalW);
    b.quaternion.slerp(local, weight);
    b.updateMatrixWorld(true);
  }
  /**
   * Hand shapes. Finger bones bend toward the palm about their local Z.
   * shape: fist | relaxed | open | bird (middle finger up) | spread
   */
  hand(side: "l" | "r", shape: "fist" | "relaxed" | "open" | "bird" | "spread", amount = 1) {
    const S = side === "l" ? "L" : "R";
    const sign = (this as any).fingerSign?.[side] ?? 1;
    const curl: Record<string, number[]> = {
      fist: [1.45, 1.6, 1.2],
      relaxed: [0.35, 0.5, 0.35],
      open: [0.05, 0.08, 0.05],
      spread: [0, 0.05, 0.02],
    };
    for (let f = 0; f <= 4; f++) {
      for (let seg = 0; seg < 3; seg++) {
        const name = `Bip01_${S}_Finger${f}${seg ? seg : ""}`;
        const b = this.bones[name];
        if (!b) continue;
        let a: number;
        if (f === 0) {
          // thumb folds across the fingers in a fist
          a = shape === "fist" || shape === "bird" ? [0.5, 0.7, 0.8][seg] : shape === "relaxed" ? 0.2 : 0;
        } else if (shape === "bird") {
          a = f === 2 ? [0, 0.02, 0][seg] : curl.fist[seg];
        } else a = curl[shape][seg];
        const rest = this.restLocal.get(b)!;
        _q.setFromAxisAngle(new T.Vector3(0, 0, 1), a * amount * sign);
        b.quaternion.copy(rest).multiply(_q);
        if (shape === "spread" && seg === 0 && f > 0) b.quaternion.multiply(_q2.setFromAxisAngle(new T.Vector3(0, 1, 0), (f - 2.5) * 0.12));
      }
    }
  }
  /**
   * Two-bone IK: place hand/foot at target (world). pole = world point the elbow/knee should bend toward.
   */
  ik(limb: "lArm" | "rArm" | "lLeg" | "rLeg", target: T.Vector3, pole: T.Vector3, weight = 1) {
    const [a, bk, c] = ({
      lArm: ["lUpper", "lFore", "lHand"],
      rArm: ["rUpper", "rFore", "rHand"],
      lLeg: ["lThigh", "lCalf", "lFoot"],
      rLeg: ["rThigh", "rCalf", "rFoot"],
    } as const)[limb];
    const pa = this.pos(a), pb = this.pos(bk), pc = this.pos(c);
    const l1 = pa.distanceTo(pb), l2 = pb.distanceTo(pc);
    const tgt = target.clone();
    const d = Math.min(tgt.distanceTo(pa), (l1 + l2) * 0.999);
    const dir = tgt.clone().sub(pa).normalize();
    tgt.copy(pa).addScaledVector(dir, d);
    // elbow position via law of cosines, in the plane of (dir, pole)
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const poleDir = pole.clone().sub(pa);
    poleDir.addScaledVector(dir, -poleDir.dot(dir)).normalize();
    if (!isFinite(poleDir.x) || poleDir.lengthSq() < 1e-6) poleDir.set(0, 0, 1);
    const elbow = pa.clone().addScaledVector(dir, cosA * l1).addScaledVector(poleDir, sinA * l1);
    this.aim(a, elbow, weight);
    this.aim(bk, tgt, weight);
  }
}

/* --------------------------- mocap retarget --------------------------- *
 * Joint-position retargeting: we record the source actor's joint positions
 * each frame, then pose our rig by aiming each bone along the source's
 * limb directions (our own bone lengths are kept). Elbows/knees use the
 * source joint as the pole, so bends always go the right way.
 * ------------------------------------------------------------------------ */

export type J = "hips" | "spine" | "chest" | "neck" | "head" | "lSh" | "lEl" | "lWr" | "rSh" | "rEl" | "rWr" | "lHip" | "lKn" | "lAn" | "lToe" | "rHip" | "rKn" | "rAn" | "rToe" | "lClav" | "rClav";
const SRC: Record<J, string> = {
  hips: "Hips", spine: "Spine", chest: "Chest", neck: "Neck", head: "Head",
  lClav: "Shoulder_L", lSh: "UpperArm_L", lEl: "LowerArm_L", lWr: "Hand_L",
  rClav: "Shoulder_R", rSh: "UpperArm_R", rEl: "LowerArm_R", rWr: "Hand_R",
  lHip: "UpperLeg_L", lKn: "LowerLeg_L", lAn: "Foot_L", lToe: "Toes_L",
  rHip: "UpperLeg_R", rKn: "LowerLeg_R", rAn: "Foot_R", rToe: "Toes_R",
};

export type Mocap = { name: string; fps: number; frames: number; duration: number; pos: Record<J, T.Vector3>[]; legLen: number };

const bvhCache = new Map<string, Promise<Mocap>>();
export function loadMocap(url: string) {
  if (!bvhCache.has(url)) bvhCache.set(url, buildMocap(url));
  return bvhCache.get(url)!;
}

async function buildMocap(url: string): Promise<Mocap> {
  const { skeleton, clip } = await new BVHLoader().loadAsync(url);
  const root = skeleton.bones[0];
  const holder = new T.Group();
  holder.add(root);
  const byName: Record<string, T.Bone> = {};
  skeleton.bones.forEach((b) => { if (!byName[b.name]) byName[b.name] = b; });
  const fps = 30;
  const frames = Math.max(2, Math.round(clip.duration * fps));
  const mixer = new T.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const raw: Record<J, T.Vector3>[] = [];
  for (let f = 0; f < frames; f++) {
    mixer.setTime(f / fps);
    holder.updateMatrixWorld(true);
    const o = {} as Record<J, T.Vector3>;
    for (const [j, n] of Object.entries(SRC) as [J, string][]) o[j] = byName[n].getWorldPosition(new T.Vector3()).multiplyScalar(0.01);
    raw.push(o);
  }
  // Face +Z at frame 0 and put the hips over the origin.
  const f0 = raw[0];
  const left = f0.lHip.clone().sub(f0.rHip).setY(0).normalize();
  const fwd = new T.Vector3().crossVectors(left, new T.Vector3(0, 1, 0)).normalize();
  // our convention: facing +Z, left = +X  → yaw that maps fwd to +Z
  const yaw = Math.atan2(fwd.x, fwd.z);
  const rot = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -yaw);
  const origin = f0.hips.clone().setY(0);
  const pos = raw.map((o) => {
    const n = {} as Record<J, T.Vector3>;
    for (const j of Object.keys(o) as J[]) n[j] = o[j].clone().sub(origin).applyQuaternion(rot);
    return n;
  });
  // sanity: if left ended up on -X, mirror-correct by rotating 180
  if (pos[0].lHip.x < pos[0].rHip.x) {
    const flip = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI);
    pos.forEach((o) => (Object.keys(o) as J[]).forEach((j) => o[j].applyQuaternion(flip)));
  }
  const legLen = pos[0].lHip.distanceTo(pos[0].lKn) + pos[0].lKn.distanceTo(pos[0].lAn);
  return { name: url, fps, frames, duration: frames / fps, pos, legLen };
}

export type Pose = Record<J, T.Vector3>;
export function samplePose(mc: Mocap, t: number, loop = false): Pose {
  let f = t * mc.fps;
  if (loop) f = ((f % (mc.frames - 1)) + (mc.frames - 1)) % (mc.frames - 1);
  f = Math.max(0, Math.min(mc.frames - 1.001, f));
  const i = Math.floor(f), a = f - i;
  const o = {} as Pose;
  for (const j of Object.keys(mc.pos[i]) as J[]) o[j] = mc.pos[i][j].clone().lerp(mc.pos[i + 1][j], a);
  return o;
}
export function lerpPose(a: Pose, b: Pose, w: number): Pose {
  if (w <= 0) return a;
  if (w >= 1) return b;
  const o = {} as Pose;
  for (const j of Object.keys(a) as J[]) o[j] = a[j].clone().lerp(b[j], w);
  return o;
}
/** mirror a pose left↔right (useful for southpaw or swapping punching hand) */
export function mirrorPose(p: Pose): Pose {
  const sw: Record<string, string> = {};
  (Object.keys(p) as J[]).forEach((j) => (sw[j] = j.startsWith("l") ? "r" + j.slice(1) : j.startsWith("r") ? "l" + j.slice(1) : j));
  const o = {} as Pose;
  (Object.keys(p) as J[]).forEach((j) => { const v = p[sw[j] as J].clone(); v.x *= -1; o[j] = v; });
  return o;
}

/** basis quaternion from a forward-ish and up vector (Z = forward, Y = up) */
function basis(fwd: T.Vector3, up: T.Vector3) {
  const z = fwd.clone().normalize(), x = new T.Vector3().crossVectors(up, z).normalize(), y = new T.Vector3().crossVectors(z, x).normalize();
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
}

/**
 * Pose the rig from source joint positions (character space). The actor
 * group should already be placed/rotated in the world by the caller.
 */
export function applyPose(rig: Rig, p: Pose, opts: { hipScale?: number } = {}) {
  rig.reset();
  const g = rig.group;
  g.updateMatrixWorld(true);
  const toWorld = (v: T.Vector3) => v.clone().applyMatrix4(g.parent!.matrixWorld);
  // hips height/offset (scale source to our leg length ≈ 0.86 m)
  const scale = opts.hipScale ?? 1;
  const root = rig.bones["Bip01"];
  const rest = rig.restPos.get(root)!;
  root.position.set(p.hips.x * 100 * scale, rest.y * 0 + p.hips.y * 100 * scale, p.hips.z * 100 * scale);
  // pelvis: forward from hip line, up along spine
  const hipLine = p.lHip.clone().sub(p.rHip);
  const up = p.spine.clone().sub(p.hips).normalize();
  const fwd = new T.Vector3().crossVectors(hipLine, up).normalize();
  const restFwd = new T.Vector3(0, 0, 1), restUp = new T.Vector3(0, 1, 0);
  const pelvisRot = basis(fwd, up).multiply(basis(restFwd, restUp).invert());
  // rotate every rest orientation for pelvis by pelvisRot
  rig.setWorldQ("pelvis", pelvisRot.clone().multiply(rig.restWorldQ.get("pelvis")!));
  // spine chain: aim each segment along source spine directions, with chest forward from shoulder line
  const chestUp = p.neck.clone().sub(p.chest).normalize();
  const shLine = p.lSh.clone().sub(p.rSh);
  const chestFwd = new T.Vector3().crossVectors(shLine, chestUp).normalize();
  const chestRot = basis(chestFwd, chestUp).multiply(basis(restFwd, restUp).invert());
  const midRot = pelvisRot.clone().slerp(chestRot, 0.5);
  rig.setWorldQ("spine", midRot.clone().multiply(rig.restWorldQ.get("spine")!));
  rig.setWorldQ("spine1", chestRot.clone().slerp(midRot, 0.3).multiply(rig.restWorldQ.get("spine1")!));
  const s2 = rig.bones["Bip01_Spine2"];
  if (s2) {
    // spine2 carries the remainder of the chest rotation
    const s1w = rig.worldQ("spine1");
    void s1w;
  }
  // neck/head
  const headDir = p.head.clone().sub(p.neck).normalize();
  const headRot = basis(chestFwd.clone().addScaledVector(headDir, -chestFwd.dot(headDir)).normalize(), headDir).multiply(basis(restFwd, restUp).invert());
  rig.setWorldQ("neck", chestRot.clone().slerp(headRot, 0.5).multiply(rig.restWorldQ.get("neck")!));
  rig.setWorldQ("head", headRot.clone().multiply(rig.restWorldQ.get("head")!));
  // arms: clavicle aim, then IK with source elbow as pole
  for (const s of ["l", "r"] as const) {
    const sh = toWorld(p[`${s}Sh`]), el = toWorld(p[`${s}El`]), wr = toWorld(p[`${s}Wr`]);
    // clavicle: small follow of shoulder raise
    const clavTo = rig.pos(`${s}Clav`).add(toWorld(p[`${s}Sh`]).sub(toWorld(p[`${s}Clav`])).normalize().multiplyScalar(0.15));
    rig.aim(`${s}Clav`, clavTo, 0.6);
    const shoulder = rig.pos(`${s}Upper`);
    const upperLen = rig.pos(`${s}Upper`).distanceTo(rig.pos(`${s}Fore`));
    const foreLen = rig.pos(`${s}Fore`).distanceTo(rig.pos(`${s}Hand`));
    const dirU = el.clone().sub(sh).normalize(), dirF = wr.clone().sub(el).normalize();
    const elbow = shoulder.clone().addScaledVector(dirU, upperLen);
    const wrist = elbow.clone().addScaledVector(dirF, foreLen);
    rig.aim(`${s}Upper`, elbow);
    rig.aim(`${s}Fore`, wrist);
    rig.aim(`${s}Hand`, wrist.clone().addScaledVector(dirF, 0.1), 0.7);
  }
  // legs
  for (const s of ["l", "r"] as const) {
    const hp = toWorld(p[`${s}Hip`]), kn = toWorld(p[`${s}Kn`]), an = toWorld(p[`${s}An`]), toe = toWorld(p[`${s}Toe`]);
    const hip = rig.pos(`${s}Thigh`);
    const thighLen = rig.pos(`${s}Thigh`).distanceTo(rig.pos(`${s}Calf`));
    const calfLen = rig.pos(`${s}Calf`).distanceTo(rig.pos(`${s}Foot`));
    const knee = hip.clone().addScaledVector(kn.clone().sub(hp).normalize(), thighLen);
    const ankle = knee.clone().addScaledVector(an.clone().sub(kn).normalize(), calfLen);
    rig.aim(`${s}Thigh`, knee);
    rig.aim(`${s}Calf`, ankle);
    // foot: rotate so the toe points the same way as the source
    const toeDir = toe.clone().sub(an).normalize();
    const footW = rig.pos(`${s}Foot`), toeW = rig.pos(`${s}Toe`);
    const curDir = toeW.clone().sub(footW).normalize();
    const b = rig.b(`${s}Foot`);
    const wq = b.getWorldQuaternion(new T.Quaternion());
    const goal = new T.Quaternion().setFromUnitVectors(curDir, toeDir).multiply(wq);
    const pw = b.parent!.getWorldQuaternion(new T.Quaternion());
    b.quaternion.copy(pw.invert().multiply(goal));
    b.updateMatrixWorld(true);
  }
}
