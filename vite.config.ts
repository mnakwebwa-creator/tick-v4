import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  // onnxruntime-web ships its own WebAssembly; let Vite copy it as-is
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  server: { proxy: { "/api": "http://localhost:4000" } },
});
