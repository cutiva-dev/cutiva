import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

// Work against package sources so edits show up without a rebuild.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@cutiva/core", replacement: pkg("core/src/index.ts") },
      { find: "@cutiva/web", replacement: pkg("web/src/index.ts") },
      { find: "@cutiva/react/styles.css", replacement: pkg("react/styles.css") },
      { find: "@cutiva/react", replacement: pkg("react/src/index.ts") },
    ],
  },
});
