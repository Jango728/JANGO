import * as T from "three";
import { makeFighter, type Actor } from "./characters";
import { loadMotion, sample, applyMPose, headingOf, type ClipRef } from "./retarget";
import { texReady } from "./rig";
import { bakeRagdoll } from "./ragdoll";

const params = new URLSearchParams(location.search);
const W = +(params.get("w") ?? 1600), H = +(params.get("h") ?? 900);
const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.toneMapping = T.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#303238");
scene.add(new T.HemisphereLight("#fff", "#444", 1.6));
const sun = new T.DirectionalLight("#fff", 2.5); sun.position.set(2, 5, 3); sun.castShadow = true; scene.add(sun);
const grid = new T.GridHelper(10, 20, "#888", "#555"); scene.add(grid);
const cam = new T.PerspectiveCamera(35, 1, 0.1, 100);
let actor: Actor;
async function init() {
  actor = await makeFighter({ corner: "red", female: params.get("female") === "1" });
  scene.add(actor.root);
  await texReady();
}
/** grid of frames: cols x rows tiles from clip [t0, t1] */
(window as any).sheet = async (name: string, t0: number, t1: number, cols = 6, rows = 4, opts: any = {}) => {
  const m = await loadMotion(name);
  const c: ClipRef = { m, anchor: opts.anchor ?? t0, heading: opts.heading ?? "hips", mirror: !!opts.mirror };
  const n = cols * rows, tw = W / cols, th = H / rows;
  renderer.setScissorTest(true);
  renderer.setClearColor("#303238");
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1);
    const p = sample(c, t);
    actor.root.position.set(0, 0, 0); actor.root.rotation.set(0, 0, 0); actor.root.updateMatrixWorld(true);
    applyMPose(actor.rig, p);
    actor.rig.hand("l", opts.hand ?? "fist"); actor.rig.hand("r", opts.hand ?? "fist");
    const hp = actor.rig.pos(opts.focus ?? "pelvis");
    const pick = (k: string, d: number) => (Array.isArray(opts[k]) ? opts[k][i % opts[k].length] : opts[k] ?? d);
    const az = pick('az', 0.9) + (opts.rel ? headingOf(p.q.hips) : 0);
    cam.aspect = tw / th; cam.fov = pick('fov', 40); cam.updateProjectionMatrix();
    const dist = pick('dist', 3.6);
    cam.position.set(hp.x + Math.sin(az) * dist, opts.focus ? hp.y + pick('camY', 0) : pick('camY', 1.2), hp.z + Math.cos(az) * dist);
    cam.lookAt(hp.x, opts.focus ? hp.y : pick('lookY', 0.9), hp.z);
    const x = (i % cols) * tw, y = H - (Math.floor(i / cols) + 1) * th;
    renderer.setViewport(x, y, tw, th); renderer.setScissor(x, y, tw, th);
    renderer.render(scene, cam);
  }
  renderer.setScissorTest(false);
  return m.duration;
};
(window as any).ragtest = async (name: string, t: number, cols = 6, rows = 3, span = 2.5, opts: any = {}) => {
  (window as any).ragDebug = 1;
  const m = await loadMotion(name);
  const c: ClipRef = { m, anchor: t, heading: "hips" };
  const poseAt = (tt: number) => { actor.root.updateMatrixWorld(true); applyMPose(actor.rig, sample(c, tt)); actor.rig.hand("l", "fist"); actor.rig.hand("r", "fist"); };
  const imp = opts.imp ?? [-6, 0, -4];
  const legT = opts.legT ?? 0.06, torsoT = opts.torsoT ?? 0.35;
  const rd = await bakeRagdoll(actor.rig, poseAt, t, {
    duration: span + 0.2,
    velScale: opts.vel ?? 1,
    tone: (tt) => 1,
    toneFor: (k, tt) => /Thigh|Calf/.test(k) ? Math.max(0.03, 1 - tt / legT) : /head/.test(k) ? Math.max(0.15, 1 - tt / 0.5) * 0.8 : Math.max(0.1, 1 - tt / torsoT),
    impulses: [{ key: "head", impulse: new T.Vector3(...imp) }, { key: "torso", impulse: new T.Vector3(...(opts.timp ?? [0, 0, -8])) }] });
  const n = cols * rows, tw = W / cols, th = H / rows;
  renderer.setScissorTest(true);
  for (let i = 0; i < n; i++) {
    const tt = (span * i) / (n - 1);
    rd.apply(actor.rig, tt);
    const hp = rd.bodyPos("pelvis", tt);
    const az = opts.az ?? 1.57;
    cam.aspect = tw / th; cam.fov = 45; cam.updateProjectionMatrix();
    cam.position.set(Math.sin(az) * 3.5, 1.3, Math.cos(az) * 3.5); cam.lookAt(hp.x * 0.5, 0.6, hp.z * 0.5);
    const x = (i % cols) * tw, y = H - (Math.floor(i / cols) + 1) * th;
    renderer.setViewport(x, y, tw, th); renderer.setScissor(x, y, tw, th);
    renderer.render(scene, cam);
  }
  renderer.setScissorTest(false);
  return 1;
};
init().then(() => ((window as any).ready = true)).catch((e) => { console.error(e); (window as any).ready = "error"; });
