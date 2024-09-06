import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      name: "firefox",
      headless: true,
      provider: "webdriverio",
      providerOptions: {},
    },
  },
});
