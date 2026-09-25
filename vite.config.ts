import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Relative base so the build works from any host or sub-path.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: { outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 4000 },
});
