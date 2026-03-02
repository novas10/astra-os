import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/types/**"],
      thresholds: {
        lines: 75,
        functions: 70,
        branches: 60,
        statements: 75,
      },
    },
    testTimeout: 15_000,
  },
});
