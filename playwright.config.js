const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'Chromium Mobile',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--disable-web-security'],
        },
      },
    },
  ],
});