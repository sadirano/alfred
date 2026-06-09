import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { BASE_PATH } from "./src/config";

// This is the browser-only demo build, published to GitHub Pages under BASE_PATH
// (see src/config.ts), so assets must resolve under that base. There is no backend,
// hence no /api dev proxy, and the build emits a plain dist/ for GitHub Pages.
export default defineConfig({
  base: BASE_PATH,
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
