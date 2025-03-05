import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      instances: [{ browser: "chromium" }],
      api: { host: "0.0.0.0" },
    },
  },
});
