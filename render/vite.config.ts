import { defineConfig } from "vite";
export default defineConfig({ root: __dirname, publicDir: "public", server: { port: 5199, strictPort: true, hmr: false, watch: null }, logLevel: "warn" });
