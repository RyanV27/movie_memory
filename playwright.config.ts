import { defineConfig, devices } from '@playwright/test';

// Update BASE_URL (or set the env var) to wherever your app runs locally.
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
  // Uncomment once the app has a dev command:
  // webServer: { command: 'npm run dev', url: BASE_URL, reuseExistingServer: true },
});
