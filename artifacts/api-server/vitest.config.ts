import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["workspace"],
  },
  test: {
    environment: "node",
    testTimeout: 30000,
    include: ["src/**/*.test.ts"],
  },
});
