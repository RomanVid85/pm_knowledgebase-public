import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  // Vite loads postcss.config.mjs by default; Tailwind v4's @tailwindcss/postcss
  // plugin format is not compatible with Vite's older PostCSS interface and
  // crashes vitest on startup. Tests run in node and don't need CSS pipelines.
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
