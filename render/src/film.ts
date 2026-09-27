import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { TexturePass } from "three/addons/postprocessing/TexturePass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { buildArena, type Arena } from "./arena";
import { bakeCrowd, crowdMesh, makeFighter, makeRef, type Actor } from "./characters";
import { applyPose, loadMocap, samplePose } from "./rig";
import { initPhysics } from "./ragdoll";

/* ------------------------------------------------------------------ *
 * Offline film renderer. window.setup(cfg) builds the shot list,
 * window.frame(t) renders one motion-blurred frame at time t (seconds).
 * ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
(window as any).capV = +(params.get('capV') ?? 0.42);
(window as any).capU = +(params.get('capU') ?? 0.3);
export const W = +(params.get("w") ?? 1280), H = +(params.get("h") ?? 720);
export const SUB = +(params.get("sub") ?? 1); // motion-blur subframes

export const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = params.get("tm") === "agx" ? T.AgXToneMapping : T.ACESFilmicToneMapping;
renderer.toneMappingExposure = +(params.get("exp") ?? (params.get("tm") === "agx" ? 1.05 : 0.9));
document.body.appendChild(renderer.domElement);

export const scene = new T.Scene();
export const cam = new T.PerspectiveCamera(32, W / H, 0.1, 200);

/* ---------- accumulation (motion blur) + post ---------- */
const sceneRT = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, samples: 4 });
const accumRT = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType });
const quadScene = new T.Scene();
const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const accMat = new T.ShaderMaterial({
  uniforms: { tSrc: { value: sceneRT.texture }, uW: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
  fragmentShader: `uniform sampler2D tSrc; uniform float uW; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uW, 1.0); }`,
  blending: T.AdditiveBlending,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});
quadScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), accMat));

const composer = new EffectComposer(renderer, new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType }));
composer.addPass(new TexturePass(accumRT.texture));
/* ambient occlusion (optional, costs one extra scene pass) */
export let gtao: GTAOPass | null = null;
if (params.get("ao") !== "0") {
  gtao = new GTAOPass(scene, cam, W, H);
  gtao.output = params.get("aoout") ? (GTAOPass.OUTPUT as any)[params.get("aoout")!] : GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(gtao);
  // keep glows, beams, particles and crowd impostors out of the AO / depth pre-pass
  const orig = (gtao as any)._renderOverride.bind(gtao);
  (gtao as any)._renderOverride = (...args: any[]) => {
    const hidden: T.Object3D[] = [];
    scene.traverse((o) => {
      const m = o as T.Mesh;
      const mat = (m as any).material as T.Material | undefined;
      const skip = (o as any).isSprite || (o as any).isPoints || o.userData.noAO || (mat && !Array.isArray(mat) && (mat.blending === T.AdditiveBlending || (mat.transparent && !mat.depthWrite)));
      if (skip && o.visible) { o.visible = false; hidden.push(o); }
    });
    orig(...args);
    hidden.forEach((o) => (o.visible = true));
  };
}
/* depth of field: CoC from the scene depth, golden-angle gather */
export const dof = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, tDepth: { value: gtao ? gtao.depthTexture : null }, uNear: { value: 0.1 }, uFar: { value: 200 }, uFocus: { value: 0 }, uAperture: { value: 0 }, uRes: { value: new T.Vector2(W, H) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tDepth; uniform float uNear, uFar, uFocus, uAperture; uniform vec2 uRes; varying vec2 vUv;
    float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    float coc(vec2 uv){ float z = lin(texture2D(tDepth, uv).r); return clamp(abs(z - uFocus) / max(z, 0.05) * uAperture * 26.0, 0.0, 14.0); }
    void main(){
      vec4 c0 = texture2D(tDiffuse, vUv);
      if (uAperture < 0.0) { gl_FragColor = vec4(vec3(lin(texture2D(tDepth, vUv).r) / 10.0), 1.0); return; }
      if (uAperture <= 0.0 || uFocus <= 0.0) { gl_FragColor = c0; return; }
      float r0 = coc(vUv);
      vec3 acc = c0.rgb; float wsum = 1.0;
      for (int i = 1; i < 32; i++) {
        float fi = float(i);
        float rr = sqrt(fi / 32.0) * r0;
        float a = fi * 2.39996;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * rr / uRes;
        float rs = coc(uv);
        // background samples only count if they are blurry themselves (limits sharp-edge bleeding)
        float w = smoothstep(rr - 1.5, rr + 0.5, rs);
        acc += texture2D(tDiffuse, uv).rgb * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, c0.a);
    }`,
});
dof.uniforms.tDepth.value = gtao ? gtao.depthTexture : null; // ShaderPass clones uniforms; re-bind the live texture
composer.addPass(dof);
(window as any).dof = dof;
export const bloom = new UnrealBloomPass(new T.Vector2(W / 2, H / 2), 0.2, 0.45, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());
export const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVig: { value: 0.42 },
    uGrain: { value: 0.045 },
    uCA: { value: 0.0008 },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    uSat: { value: 1.06 },
    uDaze: { value: 0 },
    uRadial: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uCA, uFlash, uFade, uSat, uDaze, uRadial; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d,d);
      vec3 c;
      c.r = texture2D(tDiffuse, vUv - d * uCA * 6.0 * r2 * 4.0).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv + d * uCA * 6.0 * r2 * 4.0).b;
      // impact zoom blur
      if (uRadial > 0.0) { vec3 zb = vec3(0.0); for (int i = 0; i < 10; i++) { zb += texture2D(tDiffuse, vUv - d * uRadial * 0.05 * float(i) / 10.0).rgb; } c = mix(c, zb / 10.0, min(1.0, uRadial * 1.5)); }
      // dazed POV: double vision + soft smear
      if (uDaze > 0.0) {
        vec2 o = vec2(0.012 + 0.006 * sin(uTime * 1.7), 0.004 * cos(uTime * 1.3)) * uDaze;
        vec3 g = (texture2D(tDiffuse, vUv + o).rgb + texture2D(tDiffuse, vUv - o * 0.6).rgb) * 0.5;
        vec3 bl = vec3(0.0); for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; bl += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * 0.004 * uDaze).rgb; }
        c = mix(c, mix(g, bl / 8.0, 0.5), 0.45 * uDaze);
      }
      // broadcast grade: slightly warm highlights, cool shadows
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      c = mix(vec3(l), c, uSat);
      c *= mix(vec3(0.94,0.98,1.06), vec3(1.04,1.0,0.94), smoothstep(0.1,0.8,l));
      c = pow(max(c, 0.0), vec3(1.04));
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.35); // gentle S-curve
      c *= 1.0 - (uVig + 0.35 * uDaze) * smoothstep(0.12, 0.72, r2 * 2.2);
      c += (h(vUv * vec2(1280.,720.) + fract(uTime*7.3)*100.) - 0.5) * uGrain;
      c = mix(c, vec3(1.0), uFlash);
      c *= 1.0 - uFade;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);

/* ---------- post API for the scripts ---------- */
(window as any).post = {
  focus(dist: number, strength: number) {
    if (!gtao) strength = 0; // no depth buffer without the AO pre-pass
    dof.uniforms.uFocus.value = dist;
    dof.uniforms.uAperture.value = strength;
  },
  blurImpact(v: number) {
    grade.uniforms.uRadial.value = v;
  },
};

/* ---------- world ---------- */
export type World = { arena: Arena; red: Actor; blue: Actor; ref: Actor; crowd: T.InstancedMesh };
export let world: World;

async function build() {
  const tt = performance.now();
  const lg = (m: string) => console.log(m, Math.round(performance.now() - tt));
  const arena = buildArena(scene, renderer, ["RED", "BLUE"]);
  lg("arena");
  const female = params.get("female") === "1";
  const [red, blue, ref] = await Promise.all([makeFighter({ corner: "red", female }), makeFighter({ corner: "blue", female, skin: "#e8cdb8" }), makeRef()]);
  scene.add(red.root, blue.root, ref.root);
  lg("actors");
  const atlas = params.get("nocrowd") ? { texture: new T.Texture(), sequences: 1, cols: 32 } : await bakeCrowd(renderer);
  lg("crowd baked");
  const crowd = crowdMesh(atlas, arena.crowdSlots);
  crowd.userData.noAO = true;
  scene.add(crowd);
  world = { arena, red, blue, ref, crowd };
  lg("crowd slots " + arena.crowdSlots.length);
  (window as any).world = world;
  (window as any).scene = scene;
  (window as any).bloom = bloom;
  (window as any).grade = grade;
  (window as any).renderer = renderer;
}

/* ---------- per-frame scene evaluation (replaced by the director) ---------- */
export type Evaluate = (t: number) => void;
let evaluate: Evaluate = async () => {};
export function setEvaluate(fn: Evaluate) {
  evaluate = fn;
}

function evalTime(t: number) {
  (world.arena.camFlashes.material as T.ShaderMaterial).uniforms.uTime.value = t;
  const cu = (world.crowd.material as T.ShaderMaterial).uniforms;
  if (cu) cu.uTime.value = t;
  evaluate(t);
}

export function renderFrame(t: number, fps = 30, shutter = 0.5, subN = SUB) {
  const SUB = subN;
  if (maskMode) {
    evalTime(t);
    renderer.setRenderTarget(sceneRT);
    renderer.setClearColor(0x000000, 1);
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    accMat.uniforms.uW.value = 1;
    renderer.clear();
    renderer.render(quadScene, quadCam);
    return;
  }
  renderer.setRenderTarget(accumRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  for (let i = 0; i < SUB; i++) {
    const st = SUB === 1 ? t : t + ((i + 0.5) / SUB - 0.5) * (shutter / fps);
    evalTime(st);
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, cam);
    accMat.uniforms.uW.value = 1 / SUB;
    renderer.setRenderTarget(accumRT);
    renderer.autoClear = false;
    renderer.render(quadScene, quadCam);
    renderer.autoClear = true;
  }
  renderer.setRenderTarget(null);
  grade.uniforms.uTime.value = t;
  composer.render();
}

/* ---------- a default test evaluator: both fighters in stance ---------- */
async function testEval() {
  const stance = await loadMocap("bvh/dataset-1_punch_normal_001.bvh");
  setEvaluate((t) => {
    const { red, blue, ref } = world;
    red.root.position.set(-1.2, 0, 0);
    red.root.rotation.y = Math.PI / 2;
    blue.root.position.set(1.2, 0, 0.1);
    blue.root.rotation.y = -Math.PI / 2;
    ref.root.position.set(0.3, 0, -2.6);
    for (const [a, off] of [[red, 0], [blue, 1.7]] as const) {
      a.root.updateMatrixWorld(true);
      applyPose(a.rig, samplePose(stance, 0.2 + ((t + off) % 0.7), false), { hipScale: 0.86 / stance.legLen });
      a.rig.hand("l", (window as any).handShape ?? "fist");
      a.rig.hand("r", (window as any).handShape ?? "fist");
    }
    ref.root.updateMatrixWorld(true);
    ref.rig.reset();
    const lb = (window as any).lookBone;
    if (lb) {
      const a = (world as any)[lb[0]] as Actor; a.root.updateMatrixWorld(true);
      const p = a.rig.pos(lb[1]);
      (window as any).camOverride = [p.clone().add(new T.Vector3().fromArray(lb[2])).toArray(), p.toArray(), lb[3] ?? 30];
    }
    const c = (window as any).camOverride;
    if (c) { cam.position.fromArray(c[0]); cam.lookAt(new T.Vector3().fromArray(c[1])); cam.fov = c[2] ?? 32; cam.updateProjectionMatrix(); }
    else { cam.position.set(0.8, 2.3, 4.2); cam.lookAt(0, 1.0, 0); }
  });
}

(window as any).frame = async (t: number) => {
  const t0 = performance.now();
  const sf = (window as any).subFor;
  renderFrame(t, 24, 0.5, Math.max(SUB, sf ? sf(t) : 1));
  // wait for GPU (swiftshader) to finish
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return performance.now() - t0;
};
(window as any).T = T;
(window as any).lum = () => {
  // average + max linear luminance of the last scene render
  const buf = new Uint16Array(W * H * 4);
  renderer.readRenderTargetPixels(accumRT, 0, 0, W, H, buf);
  let sum = 0, max = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const l = 0.2126 * T.DataUtils.fromHalfFloat(buf[i]) + 0.7152 * T.DataUtils.fromHalfFloat(buf[i + 1]) + 0.0722 * T.DataUtils.fromHalfFloat(buf[i + 2]);
    sum += l; if (l > max) max = l;
  }
  return { avg: sum / (W * H), max };
};
(window as any).cam = cam;

/* ---------- corner-colour mask pass: W's shorts/trim → red, L's → green, all else black ---------- */
let maskMode = false;
function setupMask(W: Actor, L: Actor) {
  maskMode = true;
  scene.fog = null;
  scene.background = new T.Color(0, 0, 0);
  scene.environment = null;
  renderer.toneMapping = T.NoToneMapping;
  const black = new Map<T.Material, T.Material>();
  const owner = new Map<T.Object3D, string>();
  W.root.traverse((o) => owner.set(o, "w"));
  L.root.traverse((o) => owner.set(o, "l"));
  scene.traverse((o) => {
    const light = o as T.Light;
    if ((light as any).isLight) (light as any).castShadow = false;
    if ((o as any).isPoints || (o as any).isSprite) { o.visible = false; return; }
    const m = o as T.Mesh;
    if (!m.isMesh) return;
    if ((m.material as any)?.blending === T.AdditiveBlending) { m.visible = false; return; }
    const conv = (mat: T.Material) => {
      if (o.userData.corner && owner.get(o)) return new T.MeshBasicMaterial({ color: owner.get(o) === "w" ? 0xff0000 : 0x00ff00, side: T.DoubleSide });
      if (!black.has(mat)) {
        const src = mat as T.MeshStandardMaterial;
        black.set(mat, new T.MeshBasicMaterial({ color: 0x000000, map: src.alphaTest ? src.map ?? null : null, alphaMap: src.alphaMap ?? null, alphaTest: src.alphaTest ?? 0, side: src.side ?? T.FrontSide, visible: src.visible }));
      }
      return black.get(mat)!;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
}

async function scriptEval() {
  const kind = params.get("clip");
  if (!kind) return testEval();
  const winner = params.get("winner") ?? "red";
  const W = winner === "red" ? world.red : world.blue, L = winner === "red" ? world.blue : world.red;
  const ctx = { W, L, ref: world.ref, arena: world.arena, cam, grade: grade as any, scene, post: (window as any).post };
  const mod = await import("./scene-ko");
  const script = kind === "ko" ? await mod.koScript(ctx) : kind === "sub" ? await (await import("./scene-sub")).subScript(ctx) : await (await import("./scene-dec")).decScript(ctx);
  (window as any).duration = script.duration;
  (window as any).subFor = (script as any).sub;
  if (params.get("mask")) setupMask(W, L);
  let story = 0;
  setEvaluate((t) => {
    story = script.eval(t);
    (window as any).story = story;
    const dc = params.get("dbgcam");
    if (dc) {
      const v = dc.split(",").map(Number);
      cam.position.set(v[0], v[1], v[2]);
      cam.lookAt(v[3], v[4], v[5]);
      cam.fov = v[6] ?? 40;
      cam.updateProjectionMatrix();
    }
  });
  // screen-space anchors for the name tags on the site
  (window as any).track = () => {
    const out: Record<string, number[]> = {};
    for (const [k, a] of [["w", W], ["l", L]] as const) {
      const hp = a.rig.pos("head");
      const near = hp.distanceTo(cam.position) < 0.7 || (script as any).hideTag?.(k, story);
      const p = hp.add(new T.Vector3(0, 0.32, 0)).project(cam);
      out[k] = [+((p.x + 1) / 2).toFixed(4), +((1 - p.y) / 2).toFixed(4), p.z < 1 && !near ? 1 : 0];
    }
    return out;
  };
}

initPhysics()
  .then(build)
  .then(scriptEval)
  .then(() => ((window as any).ready = true))
  .catch((e) => {
    console.error("BUILD FAILED", e?.stack ?? e);
    (window as any).ready = "error";
  });
