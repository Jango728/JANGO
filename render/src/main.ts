import * as T from "three";
import { loadCharacter, loadMocap, Rig, samplePose, applyPose } from "./rig";

const W = 960, H = 540;
const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.toneMapping = T.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#222");
const cam = new T.PerspectiveCamera(35, W / H, 0.1, 100);
cam.position.set(0, 1.2, 4.2);
cam.lookAt(0, 0.95, 0);
scene.add(new T.HemisphereLight("#fff", "#333", 1.5));
const sun = new T.DirectionalLight("#fff", 2.5); sun.position.set(2, 5, 3); sun.castShadow = true; scene.add(sun);
const floor = new T.Mesh(new T.PlaneGeometry(10, 10), new T.MeshStandardMaterial({ color: "#ddd" })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

let rig: Rig;
async function init() {
  const g = await loadCharacter({ fbx: "rb/Sports_Male_01.fbx", maps: { body: { color: "rb/m021_body_color.jpg", normal: "rb/m021_body_normal.jpg" }, head: { color: "rb/m021_head_color.jpg", normal: "rb/m021_head_normal.jpg" } } });
  const actor = new T.Group(); actor.add(g); scene.add(actor);
  rig = new Rig(g);
}
const dbg = new T.Group(); scene.add(dbg);
const LINKS: [string, string][] = [["hips","spine"],["spine","chest"],["chest","neck"],["neck","head"],["chest","lClav"],["lClav","lSh"],["lSh","lEl"],["lEl","lWr"],["chest","rClav"],["rClav","rSh"],["rSh","rEl"],["rEl","rWr"],["hips","lHip"],["lHip","lKn"],["lKn","lAn"],["lAn","lToe"],["hips","rHip"],["rHip","rKn"],["rKn","rAn"],["rAn","rToe"]];
function drawSkel(p: any) {
  dbg.clear();
  for (const [a, b] of LINKS) {
    const g = new T.BufferGeometry().setFromPoints([p[a].clone().add(new T.Vector3(1.2, 0, 0)), p[b].clone().add(new T.Vector3(1.2, 0, 0))]);
    dbg.add(new T.Line(g, new T.LineBasicMaterial({ color: a.startsWith("l") || b.startsWith("l") ? "#f00" : b.startsWith("r") ? "#00f" : "#0a0" })));
  }
}
(window as any).show = async (clip: string, t: number, yaw = 0) => {
  const mc = await loadMocap("bvh/" + clip + ".bvh");
  rig.group.parent!.rotation.y = yaw;
  rig.group.parent!.updateMatrixWorld(true);
  const pose = samplePose(mc, t);
  applyPose(rig, pose, { hipScale: 0.86 / mc.legLen });
  // drawSkel(pose);
  renderer.render(scene, cam);
  return mc.duration;
};
init().then(() => ((window as any).ready = true));
import { probe } from "./probe";
(window as any).probe = probe;
