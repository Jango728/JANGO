import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const SEED = root + "lib/seed.json";
const DATA = root + "lib/data.ts";
const SITE_DATA = root + "lib/site-data.ts";
const V = "virtual:jango-seed";

/**
 * Splits lib/seed.json for the browser so the first view only downloads what it shows:
 * - `virtual:jango-seed` — events, the lib/data.ts constants, and which chunk holds each fighter;
 * - `virtual:jango-seed/<eventId>` — full fighter profiles for one card, loaded on demand.
 * Browser imports of lib/data.ts go to lib/site-data.ts (same exports, filled as chunks load);
 * Node scripts and checks keep importing the real lib/data.ts. seed.json itself is unchanged.
 */
function seedSplit(): Plugin {
  const plan = () => {
    const seed = JSON.parse(readFileSync(SEED, "utf8")) as { events: { id: string; fights: { a: string; b: string }[] }[]; fighters: Record<string, unknown> };
    const chunkOf: Record<string, string> = {};
    for (const e of seed.events) for (const f of e.fights) for (const id of [f.a, f.b]) if (seed.fighters[id] && !chunkOf[id]) chunkOf[id] = e.id;
    for (const id of Object.keys(seed.fighters)) chunkOf[id] ??= "other";
    return { seed, chunkOf, keys: [...new Set(Object.values(chunkOf))] };
  };
  const constants = () => {
    const src = readFileSync(DATA, "utf8");
    return ["CHECKED_AT", "PROMOTIONS", "SITE_URL"].map((name) => {
      const m = src.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+?)(?:\\s+as const)?;`));
      if (!m) throw new Error(`seed-split: couldn't read ${name} from lib/data.ts`);
      return `export const ${name} = ${JSON.stringify(JSON.parse(m[1].replace(/'/g, '"').replace(/,\s*\]/, "]")))};`;
    });
  };
  const json = (v: unknown) => `JSON.parse(${JSON.stringify(JSON.stringify(v))})`;
  return {
    name: "jango-seed-split",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source === V || source.startsWith(V + "/")) return "\0" + source;
      if (!importer || importer === SITE_DATA || !/(^|\/)data(\.ts)?$/.test(source)) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r?.id === DATA ? SITE_DATA : null;
    },
    load(id) {
      if (!id.startsWith("\0" + V)) return null;
      this.addWatchFile(SEED);
      const { seed, chunkOf, keys } = plan();
      if (id === "\0" + V) {
        this.addWatchFile(DATA);
        return [
          `export const EVENTS = ${json(seed.events)};`,
          ...constants(),
          `export const FIGHTER_CHUNK = ${json(chunkOf)};`,
          `export const CHUNKS = {${keys.map((k) => `${JSON.stringify(k)}: () => import(${JSON.stringify(V + "/" + k)})`).join(",")}};`,
        ].join("\n");
      }
      const key = id.slice(V.length + 2);
      return `export default ${json(Object.fromEntries(Object.entries(seed.fighters).filter(([fid]) => chunkOf[fid] === key)))};`;
    },
  };
}

// Relative base so the build works from any host or sub-path.
export default defineConfig({
  base: "./",
  plugins: [seedSplit(), react(), tailwind()],
  resolve: { alias: { "@": root } },
  build: {
    outDir: "dist",
    // Small flags inline as data URIs (fewer files to publish); the few big emblem flags ship as files.
    assetsInlineLimit: (file, content) => (file.includes("/lib/flags/") ? content.length < 8192 : false),
    // One stylesheet: prepare-publish.py inlines it into the page and never uploads split .css files.
    cssCodeSplit: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // React + icons change only on upgrades, so this file keeps its name across nightly builds.
        manualChunks: (id) => (/node_modules\/(react|react-dom|scheduler|lucide-react)\//.test(id) ? "vendor" : undefined),
        // Fold tiny shared chunks into their neighbours: fewer files to publish.
        experimentalMinChunkSize: 12_000,
        chunkFileNames: (c) => (c.facadeModuleId?.startsWith("\0" + V + "/") ? `assets/fighters-${c.facadeModuleId.slice(V.length + 2)}-[hash].js` : "assets/[name]-[hash].js"),
      },
    },
  },
});
