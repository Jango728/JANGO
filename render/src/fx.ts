import * as T from "three";
import { glowSprite } from "./art";

/** Sweat / spit spray from an impact point. Analytic ballistic particles. */
export function makeSpray(scene: T.Scene, n = 260) {
  const geo = new T.BufferGeometry();
  const pos = new Float32Array(n * 3);
  geo.setAttribute("position", new T.BufferAttribute(pos, 3));
  const alpha = new Float32Array(n);
  geo.setAttribute("alpha", new T.BufferAttribute(alpha, 1));
  const mat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uMap: { value: glowSprite("#ffffff") }, uSize: { value: 4.5 } },
    vertexShader: `attribute float alpha; varying float vA; uniform float uSize; void main(){ vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = uSize * (0.6 + fract(sin(float(gl_VertexID))*43758.)) / -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.9,0.93,0.97)*1.3, t.a * vA * 0.7); }`,
  });
  const pts = new T.Points(geo, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  scene.add(pts);
  // per-particle random launch parameters
  const seeds = Array.from({ length: n }, (_, i) => {
    const r = (k: number) => {
      const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    return { a: r(1) * Math.PI * 2, spread: Math.pow(r(2), 0.7), speed: 1.2 + r(3) * 3.6, life: 0.5 + r(4) * 0.9, delay: r(5) * 0.05 };
  });
  const g = new T.Vector3(0, -9.8, 0);
  return {
    points: pts,
    update(t: number, t0: number, origin: T.Vector3, dir: T.Vector3) {
      const dt0 = t - t0;
      pts.visible = dt0 > 0 && dt0 < 1.6;
      if (!pts.visible) return;
      const d = dir.clone().normalize();
      const side = new T.Vector3().crossVectors(d, new T.Vector3(0, 1, 0)).normalize();
      const up = new T.Vector3().crossVectors(side, d).normalize();
      seeds.forEach((s, i) => {
        const dt = Math.max(0, dt0 - s.delay);
        const cone = s.spread * 0.75;
        const v = d.clone().multiplyScalar(Math.cos(cone)).addScaledVector(side, Math.sin(cone) * Math.cos(s.a)).addScaledVector(up, Math.sin(cone) * Math.sin(s.a) + 0.15).multiplyScalar(s.speed);
        const p = origin.clone().addScaledVector(v, dt).addScaledVector(g, 0.5 * dt * dt);
        if (p.y < 0.005) p.y = 0.005;
        pos.set([p.x, p.y, p.z], i * 3);
        alpha[i] = dt0 < s.delay ? 0 : Math.max(0, 1 - dt / s.life);
      });
      geo.attributes.position.needsUpdate = true;
      geo.attributes.alpha.needsUpdate = true;
    },
  };
}

/** film time → story time with slow-motion windows */
export function timeWarp(windows: { from: number; to: number; rate: number; ramp: number }[], total: number) {
  const step = 1 / 1000;
  const table: number[] = [0];
  let s = 0;
  for (let t = step; t <= total + 1; t += step) {
    let r = 1;
    for (const w of windows) {
      const a = Math.min(1, Math.max(0, (t - w.from) / w.ramp)) * Math.min(1, Math.max(0, (w.to - t) / w.ramp));
      r = Math.min(r, 1 - (1 - w.rate) * a);
    }
    s += r * step;
    table.push(s);
  }
  return (t: number) => {
    const i = Math.max(0, Math.min(table.length - 2, Math.floor(t / step)));
    const f = t / step - i;
    return table[i] * (1 - f) + table[i + 1] * f;
  };
}
