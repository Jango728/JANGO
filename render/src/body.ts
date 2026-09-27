import * as T from "three";

/* ------------------------------------------------------------------ *
 * Athlete body sculpt + skinned 4oz MMA gloves.
 *
 * Rocketbox's Sports_Male_01 is a slim everyman. We sculpt the bind
 * pose into a middleweight MMA build (deltoids, traps, lats, pecs, arms,
 * quads, calves) by pushing vertices along their normals with smooth
 * anatomical masks, then rebuild normals (seam-aware).
 *
 * Gloves are a shell grown from the hand's own skin (same skin weights),
 * so the padding follows the knuckles as the fist closes: padded dorsal
 * knuckle bar, thin palm, open fingers with loops, wrist cuff + strap.
 * Geometry space of the Rocketbox body: cm, Z up, -Y front, +X = left.
 * ------------------------------------------------------------------ */

type V3 = [number, number, number];
const g3 = (dx: number, dy: number, dz: number, r: V3) => Math.exp(-((dx * dx) / (r[0] * r[0]) + (dy * dy) / (r[1] * r[1]) + (dz * dz) / (r[2] * r[2])));
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function boneWeights(mesh: T.SkinnedMesh) {
  const names = mesh.skeleton.bones.map((b) => b.name);
  const si = mesh.geometry.attributes.skinIndex as T.BufferAttribute, sw = mesh.geometry.attributes.skinWeight as T.BufferAttribute;
  return (i: number, re: RegExp) => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (re.test(names[si.getComponent(i, k)])) w += sw.getComponent(i, k);
    return w;
  };
}

/** recompute vertex normals, averaging across UV-seam duplicates */
function seamNormals(geo: T.BufferGeometry, only?: (i: number) => boolean) {
  const pos = geo.attributes.position as T.BufferAttribute;
  const old = (geo.attributes.normal as T.BufferAttribute).clone();
  geo.computeVertexNormals();
  const nor = geo.attributes.normal as T.BufferAttribute;
  const key = (i: number) => `${Math.round(pos.getX(i) * 50)},${Math.round(pos.getY(i) * 50)},${Math.round(pos.getZ(i) * 50)}`;
  const acc = new Map<string, T.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const v = acc.get(k) ?? new T.Vector3();
    v.x += nor.getX(i); v.y += nor.getY(i); v.z += nor.getZ(i);
    acc.set(k, v);
  }
  for (let i = 0; i < pos.count; i++) {
    const v = acc.get(key(i))!.clone().normalize();
    if (only && !only(i)) nor.setXYZ(i, old.getX(i), old.getY(i), old.getZ(i));
    else nor.setXYZ(i, v.x, v.y, v.z);
  }
  nor.needsUpdate = true;
}

export function findBody(g: T.Object3D) {
  let body: T.SkinnedMesh | null = null;
  g.traverse((o) => {
    if ((o as T.SkinnedMesh).isSkinnedMesh && !body) body = o as T.SkinnedMesh;
  });
  return body as unknown as T.SkinnedMesh;
}

export function sculptBody(g: T.Object3D, female: boolean, amount = 1) {
  const mesh = findBody(g);
  const geo = mesh.geometry;
  const pos = geo.attributes.position as T.BufferAttribute, nor = geo.attributes.normal as T.BufferAttribute;
  const W = boneWeights(mesh);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const headIdx = mats.findIndex((m) => /head/i.test(m.name));
  const isHead = new Uint8Array(pos.count);
  for (const gr of geo.groups) if (gr.materialIndex === headIdx) for (let t = gr.start; t < gr.start + gr.count; t++) isHead[geo.index ? geo.index.getX(t) : t] = 1;
  // head/body seam: body verts near it must not move or the neck cracks open
  const pk = (i: number) => `${Math.round(pos.getX(i) * 20)},${Math.round(pos.getY(i) * 20)},${Math.round(pos.getZ(i) * 20)}`;
  const headKeys = new Set<string>();
  for (let i = 0; i < pos.count; i++) if (isHead[i]) headKeys.add(pk(i));
  const seam: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) if (!isHead[i] && headKeys.has(pk(i)) && !seen.has(pk(i))) { seen.add(pk(i)); seam.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
  const seamFade = (i: number) => {
    let m = 1e9;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    for (let j = 0; j < seam.length; j += 3) { const dx = x - seam[j], dy = y - seam[j + 1], dz = z - seam[j + 2]; const d = dx * dx + dy * dy + dz * dz; if (d < m) m = d; }
    return sstep(0.3, 5, Math.sqrt(m));
  };
  const k = amount * (female ? 0.42 : 1);
  const moved = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    if (isHead[i]) continue;
    const x = pos.getX(i), h = pos.getZ(i), f = -pos.getY(i); // left, height, front
    const ax = Math.abs(x), sx = Math.sign(x) || 1;
    const nx = nor.getX(i), nh = nor.getZ(i), nf = -nor.getY(i);
    let d = 0, out = 0; // along-normal push; extra lateral push
    const wUpper = W(i, /UpperArm/), wFore = W(i, /Forearm/), wHand = W(i, /Hand|Finger/);
    const wThigh = W(i, /Thigh/), wCalf = W(i, /Calf/), wNeck = W(i, /Neck/);
    // --- shoulders & arms (A-pose arm: shoulder (21,142.8) -> elbow (41.6,123) -> wrist (58.8,104.6))
    const shx = 20.5, shh = 142.5;
    d += 1.75 * g3(ax - (shx + 1.5), h - (shh - 1.5), f - 0.5, [5.5, 6.5, 7]) * (female ? 0.8 : 1); // deltoid cap
    out += 0.6 * g3(ax - (shx + 2), h - (shh - 2), f, [5, 6, 7]);
    if (wUpper > 0.05) {
      const s = Math.min(1, Math.max(0, ((ax - shx) * 0.72 + (shh - h) * 0.69) / 28.6)); // along the upper arm
      const bump = Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 0.7);
      const bic = Math.max(0, nf) * 0.55, tri = Math.max(0, -nf) * 0.45;
      d += wUpper * bump * (1.0 + 1.15 * (bic + tri));
    }
    if (wFore > 0.05) {
      const s = Math.min(1, Math.max(0, ((ax - 41.6) * 0.63 + (123 - h) * 0.68) / 25.2));
      d += wFore * 0.85 * Math.pow(1 - s, 1.3) * Math.min(1, s * 6 + 0.35);
    }
    // --- traps (slope from neck to shoulder) and neck
    d += 2.0 * g3(ax - 9, h - 149.5, f + 3.5, [5.5, 4.5, 5]) * (female ? 0.4 : 1);
    d += wNeck * 0.8 * (1 - isHead[i]);
    // --- chest: pecs (skip for women: sports-bra shell is built on the chest)
    if (!female) {
      const pec = g3(ax - 9.5, h - 133.5, f - 9, [7, 5.5, 6]) * sstep(125, 129.5, h);
      d += 1.9 * pec * Math.max(0, nf * 0.8 + 0.2);
    }
    // --- lats (V-taper) and upper back
    d += 1.8 * g3(ax - 15, h - 127, f + 4, [4, 9, 6]) * Math.max(0, nx * sx * 0.8 + 0.2);
    out += 0.6 * g3(ax - 15, h - 128, f + 4, [4, 9, 6]);
    d += 0.55 * g3(ax - 6, h - 135, f + 10, [6, 10, 4]);
    // --- abs / obliques: slight tightening of the waist
    d -= 0.45 * g3(ax - 14, h - 108, f, [4, 5, 10]);
    // --- glutes / quads / hamstrings / calves
    d += 0.45 * g3(ax - 8, h - 88, f + 8, [6, 7, 4]);
    if (wThigh > 0.05) {
      const quad = g3(ax - 10, h - 72, f - 5, [7, 12, 6]);
      const vmo = g3(ax - 7, h - 58, f - 4, [4, 4, 5]); // teardrop above the knee
      const ham = g3(ax - 10, h - 72, f + 6, [7, 12, 5]);
      d += wThigh * (1.5 * quad + 0.8 * vmo + 0.7 * ham) * (female ? 1.3 : 1);
    }
    if (wCalf > 0.05) {
      const calf = g3(ax - 11.5, h - 38, f + 4.5, [5, 8, 4]);
      d += wCalf * 1.1 * calf;
    }
    if (wHand > 0.3) d *= 0.2;
    // fade out toward the head seam (head verts are untouched)
    d *= 1 - sstep(148, 153, h) * (1 - sstep(8, 11, ax));
    out *= 1 - sstep(148, 153, h) * (1 - sstep(8, 11, ax));
    const sf = seam.length ? seamFade(i) : 1;
    d *= k * sf;
    out *= k * sf;
    if (Math.abs(d) + Math.abs(out) < 1e-3) continue;
    moved[i] = 1;
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * d + sx * out, pos.getY(i) + nor.getY(i) * d, pos.getZ(i) + nor.getZ(i) * d);
  }
  pos.needsUpdate = true;
  seamNormals(geo, (i) => moved[i] === 1);
  geo.computeBoundingSphere();
}

/* ------------------------------ gloves ------------------------------ */

export function addSkinnedGloves(g: T.Object3D, trim: string, female = false) {
  const mesh = findBody(g);
  const geo = mesh.geometry;
  const pos = geo.attributes.position as T.BufferAttribute, nor = geo.attributes.normal as T.BufferAttribute;
  const names = mesh.skeleton.bones.map((b) => b.name);
  const si = geo.attributes.skinIndex as T.BufferAttribute, sw = geo.attributes.skinWeight as T.BufferAttribute;
  const W = boneWeights(mesh);
  // geometry(bind) -> hand-bone local: boneInverse * bindMatrix
  const handInv: Record<"L" | "R", T.Matrix4> = {
    L: mesh.skeleton.boneInverses[names.indexOf("Bip01_L_Hand")].clone().multiply(mesh.bindMatrix),
    R: mesh.skeleton.boneInverses[names.indexOf("Bip01_R_Hand")].clone().multiply(mesh.bindMatrix),
  };
  const n = pos.count;
  // ---- unique positions (the body is a non-indexed triangle soup)
  const key = (i: number) => `${Math.round(pos.getX(i) * 50)},${Math.round(pos.getY(i) * 50)},${Math.round(pos.getZ(i) * 50)}`;
  const uidOf = new Int32Array(n), first: number[] = [], unor: T.Vector3[] = [];
  const map = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let u = map.get(k);
    if (u === undefined) { u = first.length; map.set(k, u); first.push(i); unor.push(new T.Vector3()); }
    uidOf[i] = u;
    unor[u].x += nor.getX(i); unor[u].y += nor.getY(i); unor[u].z += nor.getZ(i);
  }
  const U = first.length;
  unor.forEach((v) => v.normalize());
  const off = new Float32Array(U), inG = new Uint8Array(U), glx = new Float32Array(U), gback = new Float32Array(U);
  const loc = new T.Vector3(), nl = new T.Vector3();
  const s = female ? 0.9 : 1;
  for (let u = 0; u < U; u++) {
    const i = first[u];
    const wh = W(i, /_Hand$/), wf1 = W(i, /Finger[1-4]$/), wf0 = W(i, /Finger0$/), wtip = W(i, /Finger[0-4][12]$/), wfo = W(i, /Forearm/);
    if (wtip > 0.25) continue; // open fingers
    const side = pos.getX(i) > 0 ? "L" : "R";
    loc.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(handInv[side]);
    nl.copy(unor[u]).transformDirection(handInv[side]);
    const lx = loc.x;
    const onHand = wh + wf1 + wf0 > 0.3 || (wfo > 0.15 && lx > -7.5 && lx < 1.5);
    if (!onHand || lx < -7.0 * s) continue;
    const back = -nl.y; // +1 = dorsal (back of the hand), -1 = palm
    glx[u] = lx; gback[u] = back;
    if (lx < 1.2) off[u] = 0.8; // wrist cuff / strap
    else if (wf0 > 0.35) { if (lx > 5.0) continue; off[u] = 0.3; } // thumb base only
    else if (wf1 > 0.3) { if (lx > 11.8) continue; off[u] = 0.25 + 1.7 * sstep(-0.3, 0.5, back); } // knuckle bar / finger loops
    else off[u] = 0.25 + (0.6 + 1.0 * sstep(4.0, 9.0, lx)) * sstep(-0.4, 0.5, back); // back-of-hand padding, thin palm
    inG[u] = 1;
  }
  // adjacency + smoothing so the padding is puffy and continuous
  const nb: number[][] = Array.from({ length: U }, () => []);
  for (let t = 0; t < n; t += 3) {
    const a = uidOf[t], b = uidOf[t + 1], c = uidOf[t + 2];
    nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b);
  }
  let sm = Float32Array.from(off);
  for (let it = 0; it < 4; it++) {
    const nx = new Float32Array(U);
    for (let u = 0; u < U; u++) {
      if (!inG[u]) continue;
      let acc = sm[u] * 2, c = 2;
      for (const v of nb[u]) if (inG[v]) { acc += sm[v]; c++; }
      nx[u] = acc / c;
    }
    sm = nx;
  }
  const keep: number[] = [];
  for (let t = 0; t < n; t += 3) if (inG[uidOf[t]] && inG[uidOf[t + 1]] && inG[uidOf[t + 2]]) keep.push(t, t + 1, t + 2);
  const p2 = new Float32Array(keep.length * 3), n2 = new Float32Array(keep.length * 3), gl = new Float32Array(keep.length * 2);
  const si2 = new Float32Array(keep.length * 4), sw2 = new Float32Array(keep.length * 4);
  keep.forEach((i, j) => {
    const u = uidOf[i], o = Math.max(0.22, sm[u]), nv = unor[u];
    p2[j * 3] = pos.getX(i) + nv.x * o; p2[j * 3 + 1] = pos.getY(i) + nv.y * o; p2[j * 3 + 2] = pos.getZ(i) + nv.z * o;
    gl[j * 2] = glx[u]; gl[j * 2 + 1] = gback[u];
    for (let k = 0; k < 4; k++) { si2[j * 4 + k] = si.getComponent(i, k); sw2[j * 4 + k] = sw.getComponent(i, k); }
  });
  const gg = new T.BufferGeometry();
  gg.setAttribute("position", new T.BufferAttribute(p2, 3));
  gg.setAttribute("normal", new T.BufferAttribute(n2, 3));
  gg.setAttribute("gl", new T.BufferAttribute(gl, 2));
  gg.setAttribute("skinIndex", new T.BufferAttribute(si2, 4));
  gg.setAttribute("skinWeight", new T.BufferAttribute(sw2, 4));
  seamNormals(gg);
  const tc = new T.Color(trim);
  const mat = new T.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.2, sheenColor: new T.Color("#666"), side: T.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 gl; varying vec2 vGl; varying vec3 vGP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGl = gl; vGP = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGl; varying vec3 vGP;\nfloat gh(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453);}")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float lx = vGl.x, bk = vGl.y;
        vec3 leather = vec3(0.022, 0.022, 0.025);
        vec3 trimC = vec3(${tc.r.toFixed(3)}, ${tc.g.toFixed(3)}, ${tc.b.toFixed(3)});
        vec3 col = leather;
        // cuff: trim bands at both edges, a white logo stripe on the back of the strap
        float band = (step(-6.6, lx) - step(-5.9, lx)) + (step(0.35, lx) - step(1.05, lx));
        col = mix(col, trimC, band);
        float logo = (step(-3.9, lx) - step(-2.7, lx)) * smoothstep(0.1, 0.4, bk);
        col = mix(col, vec3(0.82, 0.80, 0.76), logo);
        // stitch line where the knuckle padding meets the back plate
        float st = (1.0 - smoothstep(0.0, 0.12, abs(lx - 7.6))) * smoothstep(0.2, 0.5, bk) * step(0.5, fract(vGP.x * 1.6 + vGP.z * 1.6));
        col = mix(col, vec3(0.16), st * 0.8);
        diffuseColor.rgb = col;`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nfloat grain = gh(floor(vGP*8.0));\nroughnessFactor = clamp(roughnessFactor + (grain-0.5)*0.16, 0.2, 0.9);");
  };
  const shell = new T.SkinnedMesh(gg, mat);
  shell.position.copy(mesh.position);
  shell.quaternion.copy(mesh.quaternion);
  shell.scale.copy(mesh.scale);
  shell.bind(mesh.skeleton, mesh.bindMatrix);
  shell.castShadow = true;
  shell.receiveShadow = true;
  shell.frustumCulled = false;
  shell.userData.corner = true;
  shell.name = "gloves";
  mesh.parent!.add(shell);
  return shell;
}
