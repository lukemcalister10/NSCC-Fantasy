import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Read-only league-views SPA. Rooted at the repo root so Vercel auto-detects Vite
 * with no "Root Directory" override (see VERCEL_DEPLOY.md). `app/` holds the UI;
 * the pure engine in `src/` is imported (never modified) — notably `generateRound`
 * for D21 derived fixtures. Output → `dist/`.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
