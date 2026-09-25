import * as T from "three";

/* Procedural textures: canvas mat, fence mesh, banners, screens. All brands are invented. */

const GOLD = "#d8ad52";
const SPONSORS = ["VOLTEK", "IRONCROWN", "NORTHLINE", "KRAKEN", "APEX FUEL", "SUMMIT", "RAZORBACK", "HALCYON"];

function cv(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}
function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 1) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}
function octagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/** Canvas mat. Maps world x,z ∈ [-size/2, size/2] → texture. */
export function matTexture(size: number, fenceR: number, names: [string, string]) {
  const N = 4096, px = N / size;
  const [c, x] = cv(N, N);
  const cx = N / 2, cy = N / 2;
  // outer apron (dark) then canvas
  x.fillStyle = "#101114";
  x.fillRect(0, 0, N, N);
  const vr = (fenceR / Math.cos(Math.PI / 8)) * px;
  // canvas
  const grd = x.createRadialGradient(cx, cy, 0, cx, cy, vr);
  grd.addColorStop(0, "#f3f1ec");
  grd.addColorStop(1, "#e3e0d8");
  x.fillStyle = grd;
  octagon(x, cx, cy, vr + 4);
  x.fill();
  // perimeter band inside the fence
  x.save();
  octagon(x, cx, cy, vr + 4);
  x.clip();
  x.lineWidth = 0.55 * px;
  x.strokeStyle = "#141518";
  octagon(x, cx, cy, vr - 0.25 * px);
  x.stroke();
  // band text
  x.fillStyle = GOLD;
  x.font = `800 ${0.2 * px}px Arial Black, Arial, sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const r = vr * Math.cos(Math.PI / 8) - 0.26 * px;
    x.save();
    x.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
    x.rotate(a + Math.PI / 2);
    x.fillText(i % 2 ? "JANGO PLAYZ" : SPONSORS[i], 0, 0);
    x.restore();
  }
  // sponsor logos on canvas (big, faded like real mats)
  const logo = (txt: string, ang: number, dist: number, scale: number, color = "#1b1c20", alpha = 0.82) => {
    x.save();
    x.globalAlpha = alpha;
    x.translate(cx + Math.cos(ang) * dist * px, cy + Math.sin(ang) * dist * px);
    x.rotate(ang + Math.PI / 2);
    x.fillStyle = color;
    x.font = `900 italic ${scale * px}px Arial Black, Arial, sans-serif`;
    x.fillText(txt, 0, 0);
    x.restore();
  };
  logo("VOLTEK", 0, 2.7, 0.62, "#b3121c");
  logo("IRONCROWN", Math.PI, 2.7, 0.5);
  logo("NORTHLINE", Math.PI / 2, 2.9, 0.5, "#1d3f8f");
  logo("KRAKEN ENERGY", -Math.PI / 2, 2.9, 0.42);
  logo("APEX FUEL", Math.PI / 4, 3.25, 0.34, "#1b1c20", 0.7);
  logo("SUMMIT", (3 * Math.PI) / 4, 3.25, 0.34, "#1b1c20", 0.7);
  logo("HALCYON", (5 * Math.PI) / 4, 3.25, 0.34, "#1b1c20", 0.7);
  logo("RAZORBACK", (7 * Math.PI) / 4, 3.25, 0.34, "#b3121c", 0.7);
  // centre logo
  x.globalAlpha = 1;
  x.fillStyle = "#0e0f12";
  x.beginPath();
  x.arc(cx, cy, 1.25 * px, 0, Math.PI * 2);
  x.fill();
  x.lineWidth = 0.05 * px;
  x.strokeStyle = GOLD;
  x.beginPath();
  x.arc(cx, cy, 1.18 * px, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = "#f4efe4";
  x.font = `900 ${0.48 * px}px Arial Black, Arial, sans-serif`;
  x.fillText("JANGO", cx, cy - 0.2 * px);
  x.fillStyle = GOLD;
  x.font = `900 italic ${0.4 * px}px Arial Black, Arial, sans-serif`;
  x.fillText("PLAYZ", cx, cy + 0.3 * px);
  // wear: scuffs, sweat patches, faint blood specks
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * vr * 0.9;
    x.globalAlpha = 0.04 + rnd() * 0.06;
    x.fillStyle = rnd() < 0.08 ? "#7a0d10" : "#6b6358";
    x.beginPath();
    x.ellipse(cx + r * Math.cos(a), cy + r * Math.sin(a), 8 + rnd() * 60, 5 + rnd() * 30, rnd() * 3, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
  x.globalAlpha = 1;
  noise(x, N, N, 10, 3);
  void names;
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/** Chain-link diamond pattern (alpha) — tile this across fence panels. */
export function fenceTexture() {
  const N = 256;
  const [c, x] = cv(N, N);
  x.clearRect(0, 0, N, N);
  x.strokeStyle = "#fff";
  x.lineWidth = 16;
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(0, 0);
  x.lineTo(N, N);
  x.moveTo(N, 0);
  x.lineTo(0, N);
  x.moveTo(-N / 2, N / 2); x.lineTo(N / 2, -N / 2);
  x.moveTo(N / 2, N * 1.5); x.lineTo(N * 1.5, N / 2);
  x.moveTo(N / 2, -N / 2); x.lineTo(N * 1.5, N / 2);
  x.moveTo(-N / 2, N / 2); x.lineTo(N / 2, N * 1.5);
  x.stroke();
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

/** Big screen above the cage. */
export function screenTexture(lines: string[], accent = "#b3121c") {
  const [c, x] = cv(1024, 576);
  const g = x.createLinearGradient(0, 0, 1024, 576);
  g.addColorStop(0, "#0b0c10");
  g.addColorStop(1, "#1a1310");
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 576);
  x.fillStyle = accent;
  x.fillRect(0, 470, 1024, 106);
  x.textAlign = "center";
  x.fillStyle = "#f4efe4";
  x.font = "900 150px Arial Black, Arial";
  x.fillText("JANGO", 512, 200);
  x.fillStyle = GOLD;
  x.font = "900 italic 120px Arial Black, Arial";
  x.fillText("PLAYZ", 512, 330);
  x.fillStyle = "#fff";
  x.font = "800 58px Arial Black, Arial";
  x.fillText(lines[0] ?? "", 512, 545);
  // scanlines
  x.globalAlpha = 0.12;
  x.fillStyle = "#000";
  for (let y = 0; y < 576; y += 4) x.fillRect(0, y, 1024, 2);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/** LED ribbon board that wraps the lower bowl. */
export function ribbonTexture() {
  const [c, x] = cv(4096, 128);
  x.fillStyle = "#050507";
  x.fillRect(0, 0, 4096, 128);
  const items = ["JANGO PLAYZ", ...SPONSORS];
  x.font = "900 italic 80px Arial Black, Arial";
  x.textBaseline = "middle";
  let px = 30;
  items.concat(items).forEach((s, i) => {
    x.fillStyle = i % 3 === 0 ? GOLD : i % 3 === 1 ? "#e8e4dc" : "#d8252e";
    x.fillText(s, px, 66);
    px += x.measureText(s).width + 120;
  });
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.wrapS = T.RepeatWrapping;
  return t;
}

/** Fight-short print: base colour, black side panel, gold piping, JANGO on the leg. Sampled with rest-pose planar coords in the shader. */
export function shortsTexture(base: string) {
  const [c, x] = cv(512, 512);
  x.fillStyle = base;
  x.fillRect(0, 0, 512, 512);
  // subtle fabric weave
  x.globalAlpha = 0.08;
  for (let i = 0; i < 512; i += 3) {
    x.fillStyle = i % 6 ? "#000" : "#fff";
    x.fillRect(0, i, 512, 1);
  }
  x.globalAlpha = 1;
  x.save();
  x.translate(256, 300);
  x.rotate(-0.12);
  x.fillStyle = "#ffffffdd";
  x.font = "900 italic 92px Arial Black, Arial";
  x.textAlign = "center";
  x.fillText("JANGO", 0, 0);
  x.restore();
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

export function glowSprite(color = "#fff5e0") {
  const [c, x] = cv(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color);
  g.addColorStop(0.2, color + "cc");
  g.addColorStop(1, "#00000000");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
