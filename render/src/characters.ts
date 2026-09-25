import * as T from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { loadCharacter, Rig, tex, texReady } from "./rig";
import { shortsTexture } from "./art";

export type Actor = { root: T.Group; rig: Rig; kind: "fighter" | "ref" };

/* ------------------------------------------------------------------ *
 * Fighter: Rocketbox athlete + MMA board shorts shell + 4oz gloves.
 * ------------------------------------------------------------------ */
export async function makeFighter(opts: { corner: "red" | "blue"; female?: boolean; skin?: T.ColorRepresentation }) {
  const female = !!opts.female;
  const g = await loadCharacter(
    female
      ? { fbx: "rb/Sports_Female_01.fbx", maps: { body: { color: "rb/f021_body_color.jpg", normal: "rb/f021_body_normal.jpg" }, head: { color: "rb/f021_head_color.jpg", normal: "rb/f021_head_normal.jpg" } }, tint: opts.skin }
      : { fbx: "rb/Sports_Male_01.fbx", maps: { body: { color: "rb/m021_body_color.jpg", normal: "rb/m021_body_normal.jpg", sheen: 0.35 }, head: { color: "rb/m021_head_color.jpg", normal: "rb/m021_head_normal.jpg" } }, tint: opts.skin },
  );
  const root = new T.Group();
  root.add(g);
  const rig = new Rig(g);
  addShorts(g, opts.corner === "red" ? "#b3121c" : "#1d4fb8", female ? 0.93 : 1);
  if (female) addTop(g, opts.corner === "red" ? "#b3121c" : "#1d4fb8");
  addGloves(rig, opts.corner === "red" ? "#8e0d15" : "#0e0f12");
  return { root, rig, kind: "fighter" } as Actor;
}

/** Duplicate the hips/thigh part of the skin as an inflated shell → loose MMA shorts. */
function addShorts(g: T.Group, color: string, hs = 1) {
  let body: T.SkinnedMesh | null = null;
  g.traverse((o) => {
    if ((o as T.SkinnedMesh).isSkinnedMesh && !body) body = o as T.SkinnedMesh;
  });
  if (!body) return;
  const src = (body as T.SkinnedMesh).geometry as T.BufferGeometry;
  const pos = src.attributes.position as T.BufferAttribute, nor = src.attributes.normal as T.BufferAttribute;
  const idx = src.index;
  const at = (t: number) => (idx ? idx.getX(t) : t);
  const total = idx ? idx.count : pos.count;
  const groups = src.groups.length ? src.groups : [{ start: 0, count: total, materialIndex: 0 }];
  // bind-pose positions are in cm, character space
  // geometry is Z-up (height = z, front = -y); triangles between knee and waist
  const keep: number[] = [];
  const inRange = (i: number) => {
    const h = pos.getZ(i);
    return h > 55 * hs && h < (hs < 1 ? 112 : 104) * hs;
  };
  const bm = (body as T.SkinnedMesh).material;
  const bodyIdx = Array.isArray(bm) ? Math.max(0, bm.findIndex((mm) => /body/i.test(mm.name))) : 0;
  for (const gr of groups.filter((g) => g.materialIndex === bodyIdx)) {
    for (let t = gr.start; t < gr.start + gr.count; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      if (inRange(a) && inRange(b) && inRange(c)) {
        // skip hands hanging by the thighs in A-pose (x beyond hip width)
        if (Math.abs(pos.getX(a)) > 24 || Math.abs(pos.getX(b)) > 24 || Math.abs(pos.getX(c)) > 24) continue;
        keep.push(a, b, c);
      }
    }
  }
  const geo = new T.BufferGeometry();
  const p2 = new Float32Array(pos.count * 3), rest = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getZ(i) / hs;
    // looser fabric toward the hem, tighter at the waistband
    const puff = (y < 80 ? 1.6 + (80 - y) * 0.05 : 1.1) * (hs < 1 ? 0.8 : 1);
    p2[i * 3] = pos.getX(i) + nor.getX(i) * puff;
    p2[i * 3 + 1] = pos.getY(i) + nor.getY(i) * puff;
    p2[i * 3 + 2] = pos.getZ(i) + nor.getZ(i) * puff;
    // character convention for the shader: x = left, y = height, z = front
    rest[i * 3] = pos.getX(i);
    rest[i * 3 + 1] = pos.getZ(i) / hs;
    rest[i * 3 + 2] = -pos.getY(i);
  }
  geo.setAttribute("position", new T.BufferAttribute(p2, 3));
  geo.setAttribute("normal", nor.clone());
  geo.setAttribute("rest", new T.BufferAttribute(rest, 3));
  geo.setAttribute("skinIndex", src.attributes.skinIndex.clone());
  geo.setAttribute("skinWeight", src.attributes.skinWeight.clone());
  geo.setIndex(keep);
  const print = shortsTexture(color);
  const m = new T.MeshPhysicalMaterial({ color: "#ffffff", map: print, roughness: 0.7, sheen: 0.6, sheenColor: new T.Color(color).multiplyScalar(1.3), sheenRoughness: 0.4, side: T.DoubleSide });
  m.defines = { BAND: hs < 1 ? "107.0" : "96.0" };
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 rest; varying vec3 vRest;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = rest;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRest;")
      .replace(
        "#include <map_fragment>",
        `
        // side panel, gold piping, waistband and a leg print
        float side = abs(vRest.x);
        vec3 base = texture2D(map, vec2(0.5, 0.2)).rgb;
        vec3 col = base;
        float panel = smoothstep(13.5, 14.5, side) * (1.0 - smoothstep(19.5, 20.5, side));
        col = mix(col, vec3(0.03), panel);
        float pipe = (smoothstep(13.0, 13.4, side) - smoothstep(13.5, 13.9, side));
        col = mix(col, vec3(0.85, 0.66, 0.28), pipe);
        float band = smoothstep(BAND, BAND + 1.0, vRest.y);
        col = mix(col, vec3(0.02), band);
        col = mix(col, vec3(0.85, 0.66, 0.28), smoothstep(BAND - 0.6, BAND - 0.2, vRest.y) - smoothstep(BAND, BAND + 0.4, vRest.y));
        // print on the left front thigh
        if (vRest.z > 0.0 && vRest.x > 2.0) {
          vec2 uv = vec2((vRest.x - 3.0) / 13.0, (vRest.y - 64.0) / 16.0);
          if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            vec4 t = texture2D(map, vec2(uv.x, 0.12 + uv.y * 0.5));
            col = mix(col, t.rgb, step(0.8, dot(t.rgb, vec3(0.333))) * 0.9);
          }
        }
        diffuseColor.rgb *= col;
        `,
      );
  };
  const shell = new T.SkinnedMesh(geo, m);
  const bmesh = body as T.SkinnedMesh;
  shell.position.copy(bmesh.position);
  shell.quaternion.copy(bmesh.quaternion);
  shell.scale.copy(bmesh.scale);
  shell.bind(bmesh.skeleton, bmesh.bindMatrix);
  shell.castShadow = true;
  shell.receiveShadow = true;
  shell.frustumCulled = false;
  shell.userData.corner = true;
  (body as T.SkinnedMesh).parent!.add(shell);
}

/** Sports top for women's bouts: a snug shell over the chest band, black with a gold underband. */
function addTop(g: T.Group, color: string) {
  let body: T.SkinnedMesh | null = null;
  g.traverse((o) => {
    if ((o as T.SkinnedMesh).isSkinnedMesh && !body) body = o as T.SkinnedMesh;
  });
  if (!body) return;
  const bm = body as T.SkinnedMesh;
  const src = bm.geometry as T.BufferGeometry;
  const pos = src.attributes.position as T.BufferAttribute, nor = src.attributes.normal as T.BufferAttribute;
  const idx = src.index;
  const at = (t: number) => (idx ? idx.getX(t) : t);
  const total = idx ? idx.count : pos.count;
  const groups = src.groups.length ? src.groups : [{ start: 0, count: total, materialIndex: 0 }];
  const mats = bm.material;
  const bodyIdx = Array.isArray(mats) ? Math.max(0, mats.findIndex((mm) => /body/i.test(mm.name))) : 0;
  // generous triangle band; the clean neckline/strap edges are cut per-pixel in the shader
  const inBand = (i: number) => {
    const h = pos.getZ(i), x = Math.abs(pos.getX(i));
    return x < 17.5 && h > 104 && h < 152;
  };
  const keep: number[] = [];
  for (const gr of groups.filter((q) => q.materialIndex === bodyIdx))
    for (let t = gr.start; t < gr.start + gr.count; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      if (inBand(a) || inBand(b) || inBand(c)) if (Math.abs(pos.getX(a)) < 19 && Math.abs(pos.getX(b)) < 19 && Math.abs(pos.getX(c)) < 19) keep.push(a, b, c);
    }
  const p2 = new Float32Array(pos.count * 3), rest = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const puff = 0.45;
    p2[i * 3] = pos.getX(i) + nor.getX(i) * puff;
    p2[i * 3 + 1] = pos.getY(i) + nor.getY(i) * puff;
    p2[i * 3 + 2] = pos.getZ(i) + nor.getZ(i) * puff;
    rest[i * 3] = pos.getX(i);
    rest[i * 3 + 1] = pos.getZ(i);
    rest[i * 3 + 2] = -pos.getY(i);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(p2, 3));
  geo.setAttribute("normal", nor.clone());
  geo.setAttribute("rest", new T.BufferAttribute(rest, 3));
  geo.setAttribute("skinIndex", src.attributes.skinIndex.clone());
  geo.setAttribute("skinWeight", src.attributes.skinWeight.clone());
  geo.setIndex(keep);
  const m = new T.MeshPhysicalMaterial({ color: "#101012", roughness: 0.55, sheen: 0.5, sheenColor: new T.Color(color), side: T.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 rest; varying vec3 vRest;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = rest;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRest;")
      .replace("#include <map_fragment>", `
        // sports-bra silhouette: scooped neckline in front, straps over the shoulders, straight hem
        float ax = abs(vRest.x);
        float neck = vRest.z > 0.0 ? min(131.5 + 0.035 * ax * ax, 134.0) : 131.0;
        bool strap = ax > 4.8 && ax < 9.8 && vRest.y < 149.0;
        if (vRest.y < 109.0 || (vRest.y > neck && !strap) || ax > 17.0) discard;
        vec3 col = vec3(1.0);
        float band = 1.0 - smoothstep(111.5, 112.5, vRest.y);
        col = mix(col, vec3(${new T.Color("#d8ad52").toArray().map((v) => v.toFixed(3)).join(",")}) * 6.0, band);
        diffuseColor.rgb *= col;
      `);
  };
  const shell = new T.SkinnedMesh(geo, m);
  shell.position.copy(bm.position);
  shell.quaternion.copy(bm.quaternion);
  shell.scale.copy(bm.scale);
  shell.bind(bm.skeleton, bm.bindMatrix);
  shell.castShadow = true;
  shell.frustumCulled = false;
  shell.userData.corner = true;
  bm.parent!.add(shell);
}

/**
 * 4oz open-finger MMA gloves, parented to the hand bones (units: cm, hand space).
 * Hand bone: +X toward the knuckles, +Y out of the palm, Z across the hand.
 */
function addGloves(rig: Rig, trim: string) {
  const leather = new T.MeshPhysicalMaterial({ color: "#0b0b0d", roughness: 0.38, clearcoat: 0.65, clearcoatRoughness: 0.28, sheen: 0.3, sheenColor: new T.Color("#444") });
  const trimMat = new T.MeshPhysicalMaterial({ color: trim, roughness: 0.45, clearcoat: 0.4 });
  const goldMat = new T.MeshStandardMaterial({ color: "#c69a44", metalness: 0.8, roughness: 0.3 });
  const whiteMat = new T.MeshStandardMaterial({ color: "#e8e4dc", roughness: 0.6 });
  for (const s of ["l", "r"] as const) {
    const hand = rig.b(`${s}Hand`);
    const glove = new T.Group();
    // measured fist: knuckles at x≈9.5,y≈0; curled proximal phalanges reach y≈3.4; width z −3.4…4.6
    // back-of-hand plate over the metacarpals
    const back = new T.Mesh(new T.SphereGeometry(1, 28, 18), leather);
    back.scale.set(4.9, 1.35, 4.5);
    back.position.set(5.6, -1.75, 0.6);
    glove.add(back);
    // knuckle bumper — wraps the front of the closed fist
    const knuckle = new T.Mesh(new T.SphereGeometry(1, 28, 18), leather);
    knuckle.scale.set(1.75, 3.5, 4.9);
    knuckle.position.set(10.6, 0.8, 0.6);
    glove.add(knuckle);
    // gold stitch line across the knuckles
    const stitch = new T.Mesh(new T.BoxGeometry(0.25, 0.2, 8.0), goldMat);
    stitch.position.set(8.6, -2.95, 0.6);
    stitch.visible = false;
    glove.add(stitch);
    // thin palm strap under the fingers
    const palm = new T.Mesh(new T.CylinderGeometry(1, 1, 2.0, 24, 1, true), leather);
    palm.rotation.z = Math.PI / 2;
    palm.position.set(4.2, 0.2, 0.6);
    palm.scale.set(2.5, 1, 4.5);
    glove.add(palm);
    // wrist cuff + velcro strap
    const cuff = new T.Mesh(new T.CylinderGeometry(1, 0.94, 6.0, 28), trimMat);
    cuff.userData.corner = true;
    cuff.rotation.z = Math.PI / 2;
    cuff.position.set(-1.6, -0.1, 0.5);
    cuff.scale.set(3.3, 1, 4.0);
    glove.add(cuff);
    const band = new T.Mesh(new T.CylinderGeometry(1, 1, 1.0, 28), whiteMat);
    band.rotation.z = Math.PI / 2;
    band.position.set(-2.2, -0.1, 0.5);
    band.scale.set(3.4, 1, 4.1);
    glove.add(band);
    const strap = new T.Mesh(new T.TorusGeometry(1, 0.08, 8, 32), goldMat);
    strap.rotation.y = Math.PI / 2;
    strap.position.set(1.3, -0.1, 0.5);
    strap.scale.set(4.05, 3.3, 1);
    glove.add(strap);
    glove.traverse((o) => ((o as T.Mesh).castShadow = true));
    if (s === "r") glove.scale.z = -1;
    hand.add(glove);
  }
}

/* ------------------------------ referee ------------------------------ */
export async function makeRef() {
  const g = await loadCharacter({
    fbx: "rb/Security_Male_01.fbx",
    maps: {
      body: { color: "rb/m171_body_color.jpg", normal: "rb/m171_body_normal.jpg", rough: 0.8, sheen: 0.1 },
      head: { color: "rb/m171_head_color.jpg", normal: "rb/m171_head_normal.jpg" },
      equipment: { color: "rb/m171_equipment_color.jpg", normal: "rb/m171_equipment_normal.jpg" },
    },
  });
  // drop the cap / belt kit: a referee doesn't wear them
  g.traverse((o) => {
    const m = o as T.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat) => {
      if (/equipment/i.test(mat.name)) mat.visible = false;
    });
  });
  // referee blacks: darken the uniform (the face/hands live in the head texture and body skin areas stay readable)
  g.traverse((o) => {
    const m = o as T.Mesh;
    if (!m.isMesh) return;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
      if (/body/i.test(mat.name)) (mat as T.MeshPhysicalMaterial).color = new T.Color("#5a5a5e");
    });
  });
  // the security-guard cap lives in the head texture's lower-right block: strip those triangles
  g.traverse((o) => {
    const m = o as T.SkinnedMesh;
    if (!m.isSkinnedMesh || !Array.isArray(m.material)) return;
    const headIdx = m.material.findIndex((mm) => /head/i.test(mm.name));
    const geo = m.geometry, uv = geo.attributes.uv as T.BufferAttribute;
    const n = geo.attributes.position.count;
    const at = (t: number) => (geo.index ? geo.index.getX(t) : t);
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : n, materialIndex: 0 }];
    const idx: number[] = [];
    const ng: { start: number; count: number; materialIndex: number }[] = [];
    for (const gr of groups) {
      const start = idx.length;
      for (let t = gr.start; t < gr.start + gr.count; t += 3) {
        const a = at(t), b = at(t + 1), c = at(t + 2);
        if (gr.materialIndex === headIdx) {
          const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
          if (v < (window as any).capV && u > (window as any).capU) continue;
        }
        idx.push(a, b, c);
      }
      ng.push({ start, count: idx.length - start, materialIndex: gr.materialIndex! });
    }
    geo.setIndex(idx);
    geo.clearGroups();
    ng.forEach((gr) => geo.addGroup(gr.start, gr.count, gr.materialIndex));
  });
  const root = new T.Group();
  root.add(g);
  return { root, rig: new Rig(g), kind: "ref" } as Actor;
}

/* ------------------------------ crowd ------------------------------ *
 * Rocketbox people playing Rocketbox cheer/clap mocap, baked into an
 * atlas of animated impostors so thousands of fans cost almost nothing.
 * ------------------------------------------------------------------ */
const CROWD = [
  ["Male_Adult_01", "m002", true], ["Male_Adult_02", "m003", true], ["Male_Adult_03", "m004", true], ["Male_Adult_05", "m009", true],
  ["Male_Adult_08", "m014", true], ["Male_Adult_11", "m001", false], ["Male_Adult_14", "m012", false],
  ["Female_Adult_01", "f001", true], ["Female_Adult_03", "f003", true], ["Female_Adult_05", "f005", true], ["Female_Adult_08", "f008", true],
] as const;
const ANIMS_M = ["m_cheer_01", "m_claphands_01", "m_cheer_04"];
const ANIMS_F = ["f_cheer_01", "f_claphands_01", "f_cheer_04"];
export const CELL_W = 128, CELL_H = 256, ATLAS = 4096, FRAMES = 12;

export async function bakeCrowd(renderer: T.WebGLRenderer) {
  const loader = new FBXLoader();
  const rt = new T.WebGLRenderTarget(ATLAS, ATLAS, { colorSpace: T.SRGBColorSpace });
  // render each cell into a small multisampled target, then stamp it into the atlas
  const cellRT = new T.WebGLRenderTarget(CELL_W * 2, CELL_H * 2, { samples: 4, colorSpace: T.SRGBColorSpace });
  const stampScene = new T.Scene();
  const stampCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const stamp = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: cellRT.texture, transparent: true, blending: T.NoBlending, toneMapped: false }));
  stampScene.add(stamp);
  const t0 = performance.now();
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight("#d9dff0", "#2a2320", 1.6));
  const key = new T.DirectionalLight("#fff3e0", 2.6);
  key.position.set(0.5, 1.5, 2);
  scene.add(key);
  const cam = new T.OrthographicCamera(-0.55, 0.55, 2.0, -0.2, 0.1, 10);
  cam.position.set(0, 0.9, 4);
  cam.lookAt(0, 0.9, 0);
  const cols = Math.floor(ATLAS / CELL_W);
  const cells: { avatar: number; anim: number }[] = [];
  const anims = new Map<string, T.AnimationClip>();
  for (const n of [...ANIMS_M, ...ANIMS_F]) {
    const g = await loader.loadAsync(`anims/${n}.fbx`);
    anims.set(n, g.animations[0]);
  }
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  let cell = 0;
  for (let ai = 0; ai < CROWD.length; ai++) {
    const [name, code, hair] = CROWD[ai];
    const src = await loader.loadAsync(`crowd/${name}.fbx`);
    const g = cloneSkinned(src) as T.Group;
    g.scale.setScalar(0.01);
    g.traverse((o) => {
      const m = o as T.SkinnedMesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((old) => {
        const n = old.name.toLowerCase();
        const isHair = /opacity|hair/.test(n);
        const map = isHair && hair ? tex(`crowd/${code}_opacity_color.png`) : /head/.test(n) ? tex(`crowd/${code}_head_color.jpg`) : tex(`crowd/${code}_body_color.jpg`);
        return new T.MeshStandardMaterial({ map, roughness: 0.8, transparent: isHair, alphaTest: isHair ? 0.45 : 0, side: isHair ? T.DoubleSide : T.FrontSide });
      });
      m.material = mats.length === 1 ? mats[0] : mats;
    });
    // a beer in hand for about half the fans
    if (ai % 2 === 0) {
      const hand = g.getObjectByName("Bip01_R_Hand");
      if (hand) {
        const cup = new T.Group();
        const plastic = new T.Mesh(new T.CylinderGeometry(4.2, 3.2, 13, 16), new T.MeshStandardMaterial({ color: "#e0a431", roughness: 0.25, emissive: "#3a2400" }));
        const foam = new T.Mesh(new T.CylinderGeometry(4.25, 4.25, 1.6, 16), new T.MeshStandardMaterial({ color: "#f4efe2", roughness: 0.8 }));
        foam.position.y = 6.2;
        cup.add(plastic, foam);
        cup.rotation.x = Math.PI / 2;
        cup.position.set(7, 4, 0);
        hand.add(cup);
      }
    }
    await texReady();
    scene.add(g);
    const female = name.startsWith("Female");
    const list = female ? ANIMS_F : ANIMS_M;
    for (let an = 0; an < list.length; an++) {
      const clip = anims.get(list[an])!;
      const mixer = new T.AnimationMixer(g);
      const act = mixer.clipAction(clip);
      act.play();
      for (let f = 0; f < FRAMES; f++) {
        mixer.setTime((f / FRAMES) * clip.duration);
        g.updateMatrixWorld(true);
        const cx = (cell % cols) * CELL_W, cy = Math.floor(cell / cols) * CELL_H;
        renderer.setRenderTarget(cellRT);
        renderer.setViewport(0, 0, CELL_W * 2, CELL_H * 2);
        renderer.setScissorTest(false);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, cam);
        renderer.setRenderTarget(rt);
        renderer.setViewport(cx, cy, CELL_W, CELL_H);
        renderer.setScissor(cx, cy, CELL_W, CELL_H);
        renderer.setScissorTest(true);
        renderer.render(stampScene, stampCam);
        if (f === 0) cells.push({ avatar: ai, anim: an });
        cell++;
      }
      mixer.stopAllAction();
    }
    scene.remove(g);
    console.log("crowd avatar", ai, Math.round(performance.now() - t0));
  }
  renderer.setScissorTest(false);
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, renderer.domElement.width / renderer.getPixelRatio(), renderer.domElement.height / renderer.getPixelRatio());
  (window as any).atlasRT = rt;
  return { texture: rt.texture, sequences: cells.length, cols };
}

export function crowdMesh(atlas: { texture: T.Texture; sequences: number; cols: number }, slots: { pos: T.Vector3; yaw: number; row: number }[]) {
  const quad = new T.PlaneGeometry(1.1 * 0.98, 2.2 * 0.98);
  quad.translate(0, 0.9 - 0.2 + 0.04, 0);
  const n = slots.length;
  const mesh = new T.InstancedMesh(
    quad,
    new T.ShaderMaterial({
      transparent: false,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uTime: { value: 0 },
        uCols: { value: atlas.cols },
        uCell: { value: new T.Vector2(CELL_W / ATLAS, CELL_H / ATLAS) },
        uFrames: { value: FRAMES },
        uFogColor: { value: new T.Color("#07090d") },
        uFogDensity: { value: 0.022 },
        uExcite: { value: 0.6 },
      },
      vertexShader: `
        attribute float aSeq; attribute float aPhase; attribute float aTint;
        uniform float uTime; varying vec2 vUv; varying float vSeq; varying float vFrame; varying float vTint; varying float vFog;
        uniform float uFogDensity;
        void main(){
          vUv = uv; vSeq = aSeq; vTint = aTint;
          vFrame = floor(mod(uTime * (7.0 + aPhase * 4.0) + aPhase * 12.0, 12.0));
          // cylindrical billboard toward the camera
          vec4 center = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          vec3 toCam = normalize(vec3(cameraPosition.x - center.x, 0.0, cameraPosition.z - center.z));
          vec3 right = normalize(cross(vec3(0.0,1.0,0.0), toCam));
          vec3 world = center.xyz + right * position.x + vec3(0.0, position.y, 0.0);
          vec4 mv = viewMatrix * vec4(world, 1.0);
          vFog = 1.0 - exp(-uFogDensity*uFogDensity * dot(mv.xyz, mv.xyz));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas; uniform float uCols; uniform vec2 uCell; uniform float uFrames; uniform vec3 uFogColor;
        varying vec2 vUv; varying float vSeq; varying float vFrame; varying float vTint; varying float vFog;
        void main(){
          float cell = vSeq * uFrames + vFrame;
          vec2 origin = vec2(mod(cell, uCols), floor(cell / uCols)) * uCell;
          vec2 uv = origin + clamp(vUv, 0.004, 0.996) * uCell;
          vec4 t = texture2D(uAtlas, uv);
          if (t.a < 0.5) discard;
          // soft focus: the crowd sits well behind the plane of focus
          vec2 px = vec2(1.0 / 4096.0);
          vec3 soft = (texture2D(uAtlas, uv + vec2(px.x, 0.0)).rgb + texture2D(uAtlas, uv - vec2(px.x, 0.0)).rgb + texture2D(uAtlas, uv + vec2(0.0, px.y)).rgb + texture2D(uAtlas, uv - vec2(0.0, px.y)).rgb) * 0.25;
          vec3 c = mix(t.rgb, soft, 0.6) * (0.42 + vTint * 0.42);
          gl_FragColor = vec4(mix(c, uFogColor, vFog), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
    n,
  );
  const seq = new Float32Array(n), phase = new Float32Array(n), tint = new Float32Array(n);
  const m = new T.Matrix4();
  slots.forEach((s, i) => {
    m.makeTranslation(s.pos.x, s.pos.y + 0.02, s.pos.z);
    mesh.setMatrixAt(i, m);
    const h = Math.sin(i * 12.9898) * 43758.5453;
    const r = h - Math.floor(h);
    seq[i] = Math.floor(r * atlas.sequences);
    phase[i] = (r * 7.31) % 1;
    // rows further back sit in shadow
    tint[i] = Math.max(0, 1 - s.row / 22) * (0.7 + 0.3 * ((r * 3.7) % 1));
  });
  mesh.geometry.setAttribute("aSeq", new T.InstancedBufferAttribute(seq, 1));
  mesh.geometry.setAttribute("aPhase", new T.InstancedBufferAttribute(phase, 1));
  mesh.geometry.setAttribute("aTint", new T.InstancedBufferAttribute(tint, 1));
  mesh.frustumCulled = false;
  return mesh;
}
