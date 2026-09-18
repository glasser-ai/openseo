import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // jsdom does no harm to pure logic tests and saves a layer of per-file
    // environment configuration.
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
});
