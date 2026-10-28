import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Type-only and re-export modules have no runtime code to cover.
      exclude: ["src/types.ts", "src/index.ts"],
      reporter: ["text", "html"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
