import { defineConfig } from "@playwright/test";

const port = 5174;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  // One browser at a time: parallel runs compete for the hardware codecs and skew timing checks.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    // Google Chrome, not Playwright's Chromium: export needs the proprietary H.264 and AAC encoders.
    channel: "chrome",
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
