import { defineConfig, devices } from "@playwright/test";

const port = 5174;
// Which browsers to run, e.g. E2E_BROWSERS=chrome,edge. Playwright's WebKit doesn't run on macOS 14.
const browsers = (process.env.E2E_BROWSERS ?? "chrome,firefox,webkit").split(",");

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  // One browser at a time: parallel runs compete for the hardware codecs and skew timing checks.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    // Google Chrome, not Playwright's Chromium: export needs the proprietary H.264 and AAC encoders.
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge", viewport: { width: 1440, height: 900 } } },
  ].filter((p) => browsers.includes(p.name)),
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
