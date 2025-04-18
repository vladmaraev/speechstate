import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: 'webdriverio',
      instances: [{ browser: "firefox" }],
      api: { host: "0.0.0.0" },
    },
  },
});
