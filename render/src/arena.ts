import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { fenceTexture, glowSprite, matTexture, ribbonTexture, screenTexture } from "./art";

export const FENCE_R = 4.57; // centre → flat (30 ft octagon)
export const FENCE_VR = FENCE_R / Math.cos(Math.PI / 8);
export const FENCE_H = 1.78;
export const PLATFORM = 1.22;

export type Arena = {
  root: T.Group;
  spots: T.SpotLight[];
  beams: T.Mesh[];
  screens: T.Mesh[];
  setScreen: (lines: string[], accent?: string) => void;
  crowdSlots: { pos: T.Vector3; yaw: number; row: number }[];
  flash: T.PointLight;
  camFlashes: T.Points;
};

function octVerts(r: number) {
  const v: T.Vector2[] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    v.push(new T.Vector2(r * Math.cos(a), r * Math.sin(a)));
  }
  return v;
}

export function buildArena(scene: T.Scene, renderer: T.WebGLRenderer, names: [string, string]): Arena {
  const root = new T.Group();
  scene.add(root);

  // environment for subtle PBR reflections, dark overall
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12;
  scene.background = new T.Color("#040507");
  scene.fog = new T.FogExp2("#07090d", 0.012);

  /* ---------- canvas + apron ---------- */
  const matSize = 12;
  const mat = new T.Mesh(
    new T.PlaneGeometry(matSize, matSize),
    new T.MeshStandardMaterial({ map: matTexture(matSize, FENCE_R, names), roughness: 0.82, metalness: 0 }),
  );
  mat.rotation.x = -Math.PI / 2;
  mat.receiveShadow = true;
  root.add(mat);
  // platform skirt
  const skirt = new T.Mesh(
    new T.CylinderGeometry(6.0, 6.0, PLATFORM, 8, 1, true),
    new T.MeshStandardMaterial({ color: "#0b0b0d", roughness: 0.6, metalness: 0.2, side: T.DoubleSide }),
  );
  skirt.rotation.y = Math.PI / 8;
  skirt.position.y = -PLATFORM / 2;
  root.add(skirt);
  const skirtBand = new T.Mesh(
    new T.CylinderGeometry(6.02, 6.02, 0.28, 8, 1, true),
    new T.MeshBasicMaterial({ map: ribbonTexture(), toneMapped: false, side: T.DoubleSide }),
  );
  (skirtBand.material as T.MeshBasicMaterial).map!.repeat.set(3, 1);
  skirtBand.rotation.y = Math.PI / 8;
  skirtBand.position.y = -0.42;
  root.add(skirtBand);

  /* ---------- fence ---------- */
  const fv = octVerts(FENCE_VR);
  const ft = fenceTexture();
  const fenceMat = new T.MeshStandardMaterial({ color: "#111214", metalness: 0.55, roughness: 0.45, alphaMap: ft, alphaTest: 0.5, transparent: false, side: T.DoubleSide });
  const padMat = new T.MeshPhysicalMaterial({ color: "#0c0c0e", roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.35 });
  const goldMat = new T.MeshStandardMaterial({ color: "#b8903f", metalness: 0.8, roughness: 0.35 });
  for (let i = 0; i < 8; i++) {
    const a = fv[i], b = fv[(i + 1) % 8];
    const len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const panelMat = fenceMat.clone();
    panelMat.alphaMap = ft.clone();
    panelMat.alphaMap.repeat.set(len / 0.09, (FENCE_H - 0.2) / 0.09);
    panelMat.alphaMap.needsUpdate = true;
    const panel = new T.Mesh(new T.PlaneGeometry(len, FENCE_H - 0.22), panelMat);
    panel.position.set(mid.x, 0.12 + (FENCE_H - 0.22) / 2, mid.y);
    panel.rotation.y = -ang;
    panel.castShadow = true;
    root.add(panel);
    // bottom pad + top rail pad
    const bottom = new T.Mesh(new T.BoxGeometry(len, 0.14, 0.1), padMat);
    bottom.position.set(mid.x, 0.07, mid.y);
    bottom.rotation.y = -ang;
    root.add(bottom);
    const top = new T.Mesh(new T.CapsuleGeometry(0.075, len - 0.1, 6, 12), padMat);
    top.rotation.z = Math.PI / 2;
    const topHolder = new T.Group();
    topHolder.add(top);
    topHolder.position.set(mid.x, FENCE_H, mid.y);
    topHolder.rotation.y = -ang;
    top.castShadow = true;
    root.add(topHolder);
    // post
    const post = new T.Mesh(new T.CylinderGeometry(0.15, 0.15, FENCE_H + 0.14, 8), padMat);
    post.position.set(a.x, (FENCE_H + 0.14) / 2, a.y);
    post.castShadow = true;
    root.add(post);
    const cap = new T.Mesh(new T.SphereGeometry(0.155, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), padMat);
    cap.position.set(a.x, FENCE_H + 0.14, a.y);
    root.add(cap);
    const stripe = new T.Mesh(new T.CylinderGeometry(0.152, 0.152, 0.05, 8), goldMat);
    stripe.position.set(a.x, 1.25, a.y);
    root.add(stripe);
  }

  /* ---------- arena floor + seating bowl ---------- */
  const floor = new T.Mesh(new T.CircleGeometry(40, 64), new T.MeshStandardMaterial({ color: "#060607", roughness: 0.35, metalness: 0.3 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -PLATFORM;
  floor.receiveShadow = true;
  root.add(floor);
  const rows = 26, r0 = 9.5, rowDepth = 0.85, rowRise = 0.46;
  const profile: T.Vector2[] = [new T.Vector2(r0 - 0.5, -PLATFORM)];
  for (let r = 0; r < rows; r++) {
    const y = -PLATFORM + 0.6 + r * rowRise;
    profile.push(new T.Vector2(r0 + r * rowDepth, y), new T.Vector2(r0 + (r + 1) * rowDepth, y));
  }
  profile.push(new T.Vector2(r0 + rows * rowDepth + 2, -PLATFORM + 0.6 + rows * rowRise + 6));
  const bowl = new T.Mesh(new T.LatheGeometry(profile, 96), new T.MeshStandardMaterial({ color: "#121216", roughness: 0.9, side: T.DoubleSide }));
  bowl.receiveShadow = true;
  root.add(bowl);
  // seats (instanced) + crowd slots
  const seatGeo = new T.BoxGeometry(0.46, 0.42, 0.42);
  const perRow = (r: number) => Math.floor((2 * Math.PI * (r0 + r * rowDepth + 0.3)) / 0.58);
  let total = 0;
  for (let r = 0; r < rows; r++) total += perRow(r);
  const seats = new T.InstancedMesh(seatGeo, new T.MeshStandardMaterial({ color: "#2a0d10", roughness: 0.8 }), total);
  const crowdSlots: Arena["crowdSlots"] = [];
  const m = new T.Matrix4();
  let k = 0;
  for (let r = 0; r < rows; r++) {
    const n = perRow(r), rad = r0 + r * rowDepth + 0.35, y = -PLATFORM + 0.6 + r * rowRise;
    for (let i = 0; i < n; i++) {
      // aisles every 18 seats
      if (i % 18 === 0) continue;
      const a = (i / n) * Math.PI * 2 + r * 0.013;
      const pos = new T.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad);
      const yaw = Math.atan2(-pos.x, -pos.z);
      m.compose(pos.clone().add(new T.Vector3(0, 0.21, 0)), new T.Quaternion().setFromEuler(new T.Euler(0, yaw, 0)), new T.Vector3(1, 1, 1));
      seats.setMatrixAt(k++, m);
      crowdSlots.push({ pos, yaw, row: r });
    }
  }
  seats.count = k;
  root.add(seats);
  // LED ribbon around the bowl front
  const ribbon = new T.Mesh(new T.CylinderGeometry(r0 - 0.45, r0 - 0.45, 0.5, 96, 1, true), new T.MeshBasicMaterial({ map: ribbonTexture(), side: T.BackSide, toneMapped: false }));
  (ribbon.material as T.MeshBasicMaterial).map!.repeat.set(4, 1);
  ribbon.position.y = -PLATFORM + 0.3;
  root.add(ribbon);

  /* ---------- lighting rig ---------- */
  const truss = new T.Group();
  const trussMat = new T.MeshStandardMaterial({ color: "#1c1d21", metalness: 0.8, roughness: 0.4 });
  const H = 8.6, S = 6.2;
  for (const [x, z, w, d] of [[0, -S, 2 * S, 0.35], [0, S, 2 * S, 0.35], [-S, 0, 0.35, 2 * S], [S, 0, 0.35, 2 * S]]) {
    const beam = new T.Mesh(new T.BoxGeometry(w, 0.35, d), trussMat);
    beam.position.set(x, H, z);
    truss.add(beam);
  }
  root.add(truss);
  const spots: T.SpotLight[] = [];
  const beams: T.Mesh[] = [];
  const glow = glowSprite("#fff4df");
  const beamMat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.DoubleSide,
    uniforms: { uColor: { value: new T.Color("#ffe9c9") }, uStrength: { value: 0.055 } },
    vertexShader: `varying float vH; varying vec3 vN; varying vec3 vV; void main(){ vH = uv.y; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vH; varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(abs(dot(vN, vV)), 2.0); float fade = smoothstep(0.0, 0.9, vH); gl_FragColor = vec4(uColor * uStrength * rim * fade, 1.0); }`,
  });
  const lampPositions: T.Vector3[] = [];
  for (let i = 0; i < 16; i++) {
    const side = Math.floor(i / 4), t = (i % 4) / 3 - 0.5;
    const p = side === 0 ? new T.Vector3(t * 2 * S * 0.8, H - 0.3, -S) : side === 1 ? new T.Vector3(t * 2 * S * 0.8, H - 0.3, S) : side === 2 ? new T.Vector3(-S, H - 0.3, t * 2 * S * 0.8) : new T.Vector3(S, H - 0.3, t * 2 * S * 0.8);
    lampPositions.push(p);
    const lamp = new T.Mesh(new T.CylinderGeometry(0.2, 0.26, 0.45, 16), trussMat);
    lamp.position.copy(p);
    lamp.lookAt(0, 0, 0);
    lamp.rotateX(Math.PI / 2);
    root.add(lamp);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: glow, color: "#fff4df", blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sprite.scale.setScalar(1.3);
    sprite.position.copy(p).lerp(new T.Vector3(0, 0, 0), 0.03);
    root.add(sprite);
    // volumetric beam cone toward the canvas
    const target = new T.Vector3(p.x * 0.18, 0, p.z * 0.18);
    const len = p.distanceTo(target);
    const cone = new T.Mesh(new T.CylinderGeometry(0.12, 1.5, len, 32, 1, true), beamMat);
    cone.position.copy(p).lerp(target, 0.5);
    cone.lookAt(target);
    cone.rotateX(-Math.PI / 2);
    root.add(cone);
    beams.push(cone);
  }
  // shadow-casting key lights (a subset of the rig)
  for (const idx of [1, 6, 9, 14]) {
    const p = lampPositions[idx];
    const s = new T.SpotLight("#fff1dc", 260, 22, 0.42, 0.55, 2);
    s.position.copy(p);
    s.target.position.set(p.x * 0.12, 0, p.z * 0.12);
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0002;
    s.shadow.normalBias = 0.02;
    s.shadow.radius = 4;
    root.add(s, s.target);
    spots.push(s);
  }
  // non-shadow fill from remaining lamps (cheap)
  const fill = new T.SpotLight("#ffe7cc", 110, 24, 0.6, 0.8, 2);
  fill.position.set(0, H + 1, 0);
  fill.target.position.set(0, 0, 0);
  root.add(fill, fill.target);
  const rimA = new T.DirectionalLight("#8fb5ff", 0.35);
  rimA.position.set(-6, 5, -8);
  root.add(rimA);
  root.add(new T.HemisphereLight("#2a3140", "#0a0806", 0.35));

  // photographer flash light (pulsed by the script)
  const flash = new T.PointLight("#ffffff", 0, 14, 2);
  flash.position.set(0, 3, 6);
  root.add(flash);

  /* ---------- big screen ---------- */
  const screenGroup = new T.Group();
  screenGroup.position.set(0, 11.2, 0);
  const frame = new T.Mesh(new T.BoxGeometry(5.4, 3.2, 5.4), new T.MeshStandardMaterial({ color: "#0a0a0c", metalness: 0.6, roughness: 0.5 }));
  screenGroup.add(frame);
  const screens: T.Mesh[] = [];
  const screenMat = new T.MeshBasicMaterial({ map: screenTexture([`${names[0]} vs ${names[1]}`]), toneMapped: false });
  for (let i = 0; i < 4; i++) {
    const sc = new T.Mesh(new T.PlaneGeometry(5.0, 2.8), screenMat);
    const a = (i * Math.PI) / 2;
    sc.position.set(Math.sin(a) * 2.72, 0, Math.cos(a) * 2.72);
    sc.rotation.y = a;
    screenGroup.add(sc);
    screens.push(sc);
  }
  root.add(screenGroup);
  const setScreen = (lines: string[], accent?: string) => {
    screenMat.map?.dispose();
    screenMat.map = screenTexture(lines, accent);
    screenMat.needsUpdate = true;
  };

  /* ---------- camera flashes in the crowd ---------- */
  const flashGeo = new T.BufferGeometry();
  const fp: number[] = [];
  for (let i = 0; i < 260; i++) {
    const s = crowdSlots[(i * 7919) % crowdSlots.length];
    fp.push(s.pos.x, s.pos.y + 1.25, s.pos.z);
  }
  flashGeo.setAttribute("position", new T.Float32BufferAttribute(fp, 3));
  flashGeo.setAttribute("phase", new T.Float32BufferAttribute(fp.map((_, i) => ((i * 2654435761) % 1000) / 1000).filter((_, i) => i % 3 === 0), 1));
  const camFlashes = new T.Points(
    flashGeo,
    new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uMap: { value: glowSprite("#ffffff") } },
      vertexShader: `attribute float phase; uniform float uTime; varying float vA; void main(){ float c = fract(uTime*0.55 + phase*7.13); vA = c < 0.035 ? 1.0 - c/0.035 : (fract(phase*13.1)>0.7 ? 0.35 : 0.0); vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = (vA>0.5? 90.0 : 22.0) / -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(t.rgb * vA * 2.0, t.a*vA); }`,
    }),
  );
  root.add(camFlashes);

  return { root, spots, beams, screens, setScreen, crowdSlots, flash, camFlashes };
}
