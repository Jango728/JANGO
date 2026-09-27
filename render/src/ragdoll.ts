import * as T from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Rig } from "./rig";

/* ------------------------------------------------------------------ *
 * Physics ragdoll for the knockout (Rapier, pre-simulated & baked).
 *
 * At the moment of impact the animated pose (and its velocity, from two
 * samples) is copied into 12 rigid bodies joined by spherical joints
 * (hips, spine, neck, shoulders) and limited revolute joints (elbows,
 * knees). "Muscle tone" PD torques hold the pose for a few frames and
 * then fade: the body goes limp and falls with real weight. The whole
 * fall is simulated once at setup at 240 Hz and stored, so rendering
 * any frame at any time is deterministic.
 * ------------------------------------------------------------------ */

let ready: Promise<void> | null = null;
export function initPhysics() {
  if (!ready) ready = RAPIER.init();
  return ready;
}

type BodyDef = { key: string; bone: string; mass: number; group: number; filter: number; shapes: (P: (b: string) => T.Vector3) => { a: T.Vector3; b: T.Vector3; r: number }[] };
const DEFS: BodyDef[] = [
  { key: "pelvis", group: 1, filter: 0x100, bone: "Bip01_Pelvis", mass: 11, shapes: (P) => [{ a: P("Bip01_L_Thigh"), b: P("Bip01_R_Thigh"), r: 0.115 }] },
  {
    key: "torso", bone: "Bip01_Spine", mass: 30,
    shapes: (P) => [
      { a: P("Bip01_Spine").lerp(P("Bip01_Neck"), 0.3), b: P("Bip01_Neck").lerp(P("Bip01_Spine"), 0.15), r: 0.13 },
      { a: P("Bip01_L_UpperArm").lerp(P("Bip01_Neck"), 0.3), b: P("Bip01_R_UpperArm").lerp(P("Bip01_Neck"), 0.3), r: 0.08 },
    ],
  },
  { key: "head", group: 4, filter: 0x160, bone: "Bip01_Neck", mass: 6, shapes: (P) => [{ a: P("Bip01_Head").add(new T.Vector3(0, 0.07, 0.02)), b: P("Bip01_Head").add(new T.Vector3(0, 0.1, 0.02)), r: 0.105 }] },
  { key: "lUpper", group: 8, filter: 0x160, bone: "Bip01_L_UpperArm", mass: 2.6, shapes: (P) => [{ a: P("Bip01_L_UpperArm"), b: P("Bip01_L_Forearm"), r: 0.055 }] },
  { key: "rUpper", group: 8, filter: 0x160, bone: "Bip01_R_UpperArm", mass: 2.6, shapes: (P) => [{ a: P("Bip01_R_UpperArm"), b: P("Bip01_R_Forearm"), r: 0.055 }] },
  { key: "lFore", group: 16, filter: 0x160, bone: "Bip01_L_Forearm", mass: 1.9, shapes: (P) => [{ a: P("Bip01_L_Forearm"), b: P("Bip01_L_Hand").lerp(P("Bip01_L_Finger2"), 0.6), r: 0.048 }] },
  { key: "rFore", group: 16, filter: 0x160, bone: "Bip01_R_Forearm", mass: 1.9, shapes: (P) => [{ a: P("Bip01_R_Forearm"), b: P("Bip01_R_Hand").lerp(P("Bip01_R_Finger2"), 0.6), r: 0.048 }] },
  { key: "lThigh", group: 32, filter: 0x13e, bone: "Bip01_L_Thigh", mass: 9, shapes: (P) => [{ a: P("Bip01_L_Thigh"), b: P("Bip01_L_Calf"), r: 0.08 }] },
  { key: "rThigh", group: 32, filter: 0x13e, bone: "Bip01_R_Thigh", mass: 9, shapes: (P) => [{ a: P("Bip01_R_Thigh"), b: P("Bip01_R_Calf"), r: 0.08 }] },
  { key: "lCalf", group: 64, filter: 0x15e, bone: "Bip01_L_Calf", mass: 4.4, shapes: (P) => [{ a: P("Bip01_L_Calf"), b: P("Bip01_L_Foot"), r: 0.055 }, { a: P("Bip01_L_Foot"), b: P("Bip01_L_Toe0"), r: 0.04 }] },
  { key: "rCalf", group: 64, filter: 0x15e, bone: "Bip01_R_Calf", mass: 4.4, shapes: (P) => [{ a: P("Bip01_R_Calf"), b: P("Bip01_R_Foot"), r: 0.055 }, { a: P("Bip01_R_Foot"), b: P("Bip01_R_Toe0"), r: 0.04 }] },
];
type JointDef = { a: string; b: string; at: string; kind: "ball" | "hinge"; k: number; max: number; range?: [number, number] };
const JOINTS: JointDef[] = [
  { a: "pelvis", b: "torso", at: "Bip01_Spine", kind: "ball", k: 420, max: 0.65 },
  { a: "torso", b: "head", at: "Bip01_Neck", kind: "ball", k: 60, max: 0.75 },
  { a: "torso", b: "lUpper", at: "Bip01_L_UpperArm", kind: "ball", k: 40, max: 1.9 },
  { a: "torso", b: "rUpper", at: "Bip01_R_UpperArm", kind: "ball", k: 40, max: 1.9 },
  { a: "lUpper", b: "lFore", at: "Bip01_L_Forearm", kind: "hinge", k: 12, max: 0, range: [0.05, 2.5] },
  { a: "rUpper", b: "rFore", at: "Bip01_R_Forearm", kind: "hinge", k: 12, max: 0, range: [0.05, 2.5] },
  { a: "pelvis", b: "lThigh", at: "Bip01_L_Thigh", kind: "ball", k: 260, max: 1.5 },
  { a: "pelvis", b: "rThigh", at: "Bip01_R_Thigh", kind: "ball", k: 260, max: 1.5 },
  { a: "lThigh", b: "lCalf", at: "Bip01_L_Calf", kind: "hinge", k: 140, max: 0, range: [0.02, 2.4] },
  { a: "rThigh", b: "rCalf", at: "Bip01_R_Calf", kind: "hinge", k: 140, max: 0, range: [0.02, 2.4] },
];

export type RagdollOpts = {
  duration?: number;
  /** impulses applied at t=0: body key, impulse (N·s, world), optional world point */
  impulses?: { key: string; impulse: T.Vector3; point?: T.Vector3 }[];
  /** muscle tone 0..1 as a function of time since impact */
  tone?: (t: number) => number;
  /** per-body extra tone multiplier over time (e.g. fencing response) */
  toneFor?: (key: string, t: number) => number;
  /** override pose targets for the PD (relative rotations) as a function of time: return null to keep the impact pose */
  target?: (jointB: string, t: number) => T.Quaternion | null;
  dt?: number;
  /** scale on the captured animation velocities */
  velScale?: number;
  /** after this time the body settles: velocities decay (keeps a knocked-out body from rolling around) */
  settle?: number;
  onStep?: (t: number, bodies: Record<string, RAPIER.RigidBody>) => void;
};

export type Ragdoll = {
  duration: number;
  apply(rig: Rig, t: number): void;
  bodyPos(key: string, t: number): T.Vector3;
};

const _q = new T.Quaternion(), _q2 = new T.Quaternion(), _v = new T.Vector3(), _m = new T.Matrix4();

function Ialong(b: RAPIER.RigidBody, nW: T.Vector3) {
  const pi = b.principalInertia(), f = b.principalInertiaLocalFrame(), r = b.rotation();
  const q = new T.Quaternion(r.x, r.y, r.z, r.w).multiply(new T.Quaternion(f.x, f.y, f.z, f.w));
  const n = nW.clone().applyQuaternion(q.invert());
  return Math.max(1e-5, pi.x * n.x * n.x + pi.y * n.y * n.y + pi.z * n.z * n.z);
}
function worldQ(b: T.Object3D) {
  return b.getWorldQuaternion(new T.Quaternion());
}
function worldP(b: T.Object3D) {
  return b.getWorldPosition(new T.Vector3());
}

/**
 * poseAt(t) must pose the rig (world placement included) at scene time t.
 */
export async function bakeRagdoll(rig: Rig, poseAt: (t: number) => void, t0: number, opts: RagdollOpts = {}): Promise<Ragdoll> {
  await initPhysics();
  const dt = opts.dt ?? 1 / 240;
  const dur = opts.duration ?? 4;
  // ---- capture previous & current state
  const cap = () => {
    rig.group.updateMatrixWorld(true);
    const st: Record<string, { p: T.Vector3; q: T.Quaternion }> = {};
    for (const b of rig.order) st[b.name] = { p: worldP(b), q: worldQ(b) };
    return st;
  };
  const h = 1 / 60;
  poseAt(t0 - h);
  const prev = cap();
  poseAt(t0);
  const cur = cap();
  const locals = new Map<T.Bone, T.Quaternion>();
  for (const b of rig.order) locals.set(b, b.quaternion.clone());
  const scaleWorld = rig.group.getWorldScale(new T.Vector3()).x;

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.integrationParameters.numSolverIterations = 8;
  // ground
  const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setFriction(0.9).setRestitution(0.05).setCollisionGroups(0x0100ffff), gb);

  const P = (name: string) => cur[name].p.clone();
  const bodies: Record<string, RAPIER.RigidBody> = {};
  const q0: Record<string, T.Quaternion> = {};
  for (const d of DEFS) {
    const bp = cur[d.bone].p, bq = cur[d.bone].q;
    q0[d.key] = bq.clone();
    // velocities from the animation
    const pp = prev[d.bone].p, pq = prev[d.bone].q;
    const shapes = d.shapes(P);
    // centre of the first shape for the linear velocity estimate
    const cNow = shapes[0].a.clone().add(shapes[0].b).multiplyScalar(0.5);
    const lin = bp.clone().sub(pp).divideScalar(h).multiplyScalar(opts.velScale ?? 1);
    const dq = bq.clone().multiply(pq.clone().invert());
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const ang = 2 * Math.acos(Math.min(1, dq.w));
    const axis = new T.Vector3(dq.x, dq.y, dq.z);
    const angv = axis.lengthSq() > 1e-12 ? axis.normalize().multiplyScalar((ang / h) * (opts.velScale ?? 1)) : new T.Vector3();
    if ((window as any).ragDebug) console.log(d.key, 'lin', lin.toArray().map((v) => v.toFixed(2)).join(','), 'ang', angv.length().toFixed(2));
    // velocity of the shape centre = v(bone origin) + w x r
    const vC = lin.clone().add(new T.Vector3().crossVectors(angv, cNow.clone().sub(bp)));
    void vC;
    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(bp.x, bp.y, bp.z)
        .setRotation({ x: bq.x, y: bq.y, z: bq.z, w: bq.w })
        .setLinvel(lin.x, lin.y, lin.z)
        .setAngvel({ x: angv.x, y: angv.y, z: angv.z })
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCcdEnabled(true),
    );
    const inv = bq.clone().invert();
    const massEach = d.mass / shapes.length;
    for (const s of shapes) {
      const la = s.a.clone().sub(bp).applyQuaternion(inv), lb = s.b.clone().sub(bp).applyQuaternion(inv);
      const mid = la.clone().add(lb).multiplyScalar(0.5);
      const len = la.distanceTo(lb);
      const rot = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), lb.clone().sub(la).normalize());
      const cd = RAPIER.ColliderDesc.capsule(Math.max(0.001, len / 2), s.r)
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setMass(massEach)
        .setFriction(0.85)
        .setRestitution(0.05)
        .setCollisionGroups(((d.group & 0xffff) << 16) | (d.filter & 0xffff));
      world.createCollider(cd, rb);
    }
    bodies[d.key] = rb;
  }
  // joints: all spherical in the solver (no snapping); hinges and cone limits are soft (torques below)
  type J = JointDef & { rest: T.Quaternion; axA?: T.Vector3; axB?: T.Vector3 };
  const joints: J[] = [];
  const pelvisFwd = new T.Vector3(0, 0, 1).applyQuaternion(q0.pelvis);
  // pelvis bone: X up, Y forward (Rocketbox biped) -> use hips line instead
  {
    const l = cur["Bip01_L_Thigh"].p.clone().sub(cur["Bip01_R_Thigh"].p);
    pelvisFwd.crossVectors(l, new T.Vector3(0, 1, 0)).normalize();
  }
  for (const jd of JOINTS) {
    const A = bodies[jd.a], B = bodies[jd.b];
    const pj = cur[jd.at].p;
    const qa = q0[jd.a], qb = q0[jd.b];
    const pa = DEFS.find((d) => d.key === jd.a)!, pb = DEFS.find((d) => d.key === jd.b)!;
    const la = pj.clone().sub(cur[pa.bone].p).applyQuaternion(qa.clone().invert());
    const lb = pj.clone().sub(cur[pb.bone].p).applyQuaternion(qb.clone().invert());
    const rest = qa.clone().invert().multiply(qb);
    const data = RAPIER.JointData.spherical({ x: la.x, y: la.y, z: la.z }, { x: lb.x, y: lb.y, z: lb.z });
    const j = world.createImpulseJoint(data, A, B, true);
    j.setContactsEnabled(false);
    const jj: J = { ...jd, rest };
    if (jd.kind === "hinge") {
      const dA = new T.Vector3(1, 0, 0).applyQuaternion(qa), dB = new T.Vector3(1, 0, 0).applyQuaternion(qb);
      let ax = new T.Vector3().crossVectors(dA, dB);
      if (ax.length() < 0.15) {
        const hint = jd.b.endsWith("Calf") ? pelvisFwd.clone().negate() : pelvisFwd.clone().add(new T.Vector3(0, 0.5, 0));
        ax = new T.Vector3().crossVectors(dA, hint);
      }
      ax.normalize();
      jj.axA = ax.clone().applyQuaternion(qa.clone().invert());
      jj.axB = ax.clone().applyQuaternion(qb.clone().invert());
    }
    joints.push(jj);
  }
  // impulses
  for (const im of opts.impulses ?? []) {
    const b = bodies[im.key];
    const pt = im.point ?? new T.Vector3().copy(b.translation() as any);
    b.applyImpulseAtPoint({ x: im.impulse.x, y: im.impulse.y, z: im.impulse.z }, { x: pt.x, y: pt.y, z: pt.z }, true);
  }
  // ---- simulate
  const keys = DEFS.map((d) => d.key);
  const recEvery = 2;
  const frames: Float32Array[] = [];
  const nSteps = Math.ceil(dur / dt);
  const tone = opts.tone ?? ((t: number) => Math.max(0.12, 1 - t / 0.18));
  const toQ = (r: RAPIER.Rotation) => new T.Quaternion(r.x, r.y, r.z, r.w);
  const toV = (v: RAPIER.Vector) => new T.Vector3(v.x, v.y, v.z);
  const record = () => {
    const f = new Float32Array(keys.length * 7);
    keys.forEach((k, i) => {
      const b = bodies[k], p = b.translation(), q = b.rotation();
      f.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], i * 7);
    });
    frames.push(f);
  };
  record();
  for (let s = 0; s < nSteps; s++) {
    const t = s * dt;
    // muscle tone (PD toward the impact pose or a supplied target) + soft cone limits
    for (const j of joints) {
      const A = bodies[j.a], B = bodies[j.b];
      const qa = toQ(A.rotation()), qb = toQ(B.rotation());
      const rel = qa.clone().invert().multiply(qb);
      const tn = tone(t) * (opts.toneFor?.(j.b, t) ?? 1);
      // stable PD: every torque term is clamped by the joint's effective inertia about its axis
      const Ieff = (n: T.Vector3) => {
        const ia = Ialong(A, n), ib = Ialong(B, n);
        return (ia * ib) / (ia + ib);
      };
      const J = new T.Vector3();
      const spring = (axisW: T.Vector3, angle: number, k: number) => {
        if (Math.abs(angle) < 1e-6 || axisW.lengthSq() < 1e-12) return;
        const n = axisW.clone().normalize();
        const I = Ieff(n);
        const kk = Math.min(k, (0.15 * I) / (dt * dt));
        J.addScaledVector(n, kk * angle * dt);
      };
      const tgt = opts.target?.(j.b, t) ?? j.rest;
      {
        const e = tgt.clone().multiply(rel.clone().invert());
        if (e.w < 0) e.set(-e.x, -e.y, -e.z, -e.w);
        const ang = 2 * Math.acos(Math.min(1, e.w));
        spring(new T.Vector3(e.x, e.y, e.z).applyQuaternion(qa), ang, j.k * tn);
      }
      if (j.kind === "ball") {
        const e2 = j.rest.clone().multiply(rel.clone().invert());
        if (e2.w < 0) e2.set(-e2.x, -e2.y, -e2.z, -e2.w);
        const a2 = 2 * Math.acos(Math.min(1, e2.w));
        if (a2 > j.max) spring(new T.Vector3(e2.x, e2.y, e2.z).applyQuaternion(qa), a2 - j.max, j.k * 4 + 200);
      } else {
        const aA = j.axA!.clone().applyQuaternion(qa), aB = j.axB!.clone().applyQuaternion(qb);
        const c = new T.Vector3().crossVectors(aB, aA);
        spring(c, Math.asin(Math.min(1, c.length())), 2000);
        const dA = new T.Vector3(1, 0, 0).applyQuaternion(qa), dB = new T.Vector3(1, 0, 0).applyQuaternion(qb);
        const th = Math.atan2(new T.Vector3().crossVectors(dA, dB).dot(aA), dA.dot(dB));
        const [lo, hi] = j.range!;
        if (th < lo) spring(aA, lo - th, 3000);
        if (th > hi) spring(aA.clone().negate(), th - hi, 3000);
      }
      // damping of the relative spin (velocity level, never overshoots)
      const w = toV(B.angvel()).sub(toV(A.angvel()));
      if (w.lengthSq() > 1e-10) {
        const n = w.clone().normalize(), I = Ieff(n);
        const c = (j.kind === "hinge" ? 0.6 : 1.2) * (0.25 + tn) * Math.sqrt(Math.max(j.k, 20) * I);
        J.addScaledVector(w, -I * Math.min(0.5, (c * dt) / I));
      }
      B.applyTorqueImpulse({ x: J.x, y: J.y, z: J.z }, true);
      A.applyTorqueImpulse({ x: -J.x, y: -J.y, z: -J.z }, true);
    }
    if (opts.settle !== undefined && t > opts.settle) {
      const k = Math.min(1, (t - opts.settle) / 0.4);
      const f = 1 - 0.03 * k;
      for (const b of Object.values(bodies)) {
        const lv = b.linvel(), av = b.angvel();
        b.setLinvel({ x: lv.x * f, y: lv.y > 0 ? lv.y * f : lv.y, z: lv.z * f }, true);
        b.setAngvel({ x: av.x * f, y: av.y * f, z: av.z * f }, true);
      }
    }
    opts.onStep?.(t, bodies);
    world.step();
    if ((s + 1) % recEvery === 0) record();
  }
  const rate = 1 / (dt * recEvery);
  world.free();

  const boneOf: Record<string, string> = {};
  DEFS.forEach((d) => (boneOf[d.key] = d.bone));
  const sampleBody = (i: number, t: number) => {
    const f = Math.max(0, Math.min(frames.length - 1.001, t * rate));
    const a = Math.floor(f), u = f - a;
    const A = frames[a], B = frames[a + 1];
    const o = i * 7;
    const p = new T.Vector3(A[o], A[o + 1], A[o + 2]).lerp(new T.Vector3(B[o], B[o + 1], B[o + 2]), u);
    const q = new T.Quaternion(A[o + 3], A[o + 4], A[o + 5], A[o + 6]).slerp(new T.Quaternion(B[o + 3], B[o + 4], B[o + 5], B[o + 6]), u);
    return { p, q };
  };
  return {
    duration: dur,
    bodyPos(key, t) {
      return sampleBody(keys.indexOf(key), t).p;
    },
    apply(rig: Rig, t: number) {
      // restore impact-time locals for every bone, then drive the simulated ones in hierarchy order
      for (const [b, q] of locals) b.quaternion.copy(q);
      rig.group.updateMatrixWorld(true);
      // pelvis position: move the Bip01 root so the pelvis bone lands on the body origin
      const pel = sampleBody(0, t);
      const root = rig.bones["Bip01"];
      const pelvisBone = rig.bones["Bip01_Pelvis"];
      root.updateMatrixWorld(true);
      const curP = worldP(pelvisBone);
      const delta = pel.p.clone().sub(curP);
      // convert world delta into root-parent space
      const parentInv = _m.copy(root.parent!.matrixWorld).invert();
      const rootW = worldP(root).add(delta).applyMatrix4(parentInv);
      root.position.copy(rootW);
      root.updateMatrixWorld(true);
      void scaleWorld;
      for (let i = 0; i < keys.length; i++) {
        const b = rig.bones[boneOf[keys[i]]];
        const { q } = sampleBody(i, t);
        const pq = worldQ(b.parent!);
        b.quaternion.copy(pq.invert().multiply(q)).normalize();
        b.updateMatrixWorld(true);
      }
    },
  };
}
