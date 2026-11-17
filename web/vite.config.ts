import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps every asset URL relative, so the export works under any gateway subpath or ENS name.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts"] },
} as any);
