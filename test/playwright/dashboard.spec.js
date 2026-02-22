import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Prepare logging directory
const logDir = 'test_logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}
const logFile = path.join(logDir, 'playwright_console.log');
// Clear previous log
fs.writeFileSync(logFile, '');

test.use({
  extraHTTPHeaders: {
    // base64('admin:password') = 'YWRtaW46cGFzc3dvcmQ='
    'Authorization': 'Basic YWRtaW46cGFzc3dvcmQ='
  }
});

test.describe.serial('TORCH Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      const logLine = `[${msg.type()}] ${msg.text()}\n`;
      fs.appendFileSync(logFile, logLine);
      // Also log to stdout so it appears in the runner output
      // console.log(`[Browser Console] ${msg.text()}`);
    });
  });

  test('should load the dashboard and verify title', async ({ page }) => {
    await page.goto('/');
    // Check for title "TORCH Dashboard" or similar. Checking regex /TORCH/ is safer.
    await expect(page).toHaveTitle(/TORCH/);

    // Check for some basic element presence to ensure rendering happened
    // Assuming there is a header or main content
    // We can inspect dashboard/index.html to be sure
    // But generic check for body visibility is a start
    await expect(page.locator('body')).toBeVisible();

    // Verify console log capture
    await page.evaluate(() => console.log('Test log from browser'));
  });

  test('should fail authentication with wrong credentials', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'Authorization': 'Basic YWRtaW46d3Jvbmc=' // admin:wrong
      }
    });
    const page = await context.newPage();
    const response = await page.goto('/');
    expect(response.status()).toBe(401);
    await context.close();
  });

  test('should serve public config correctly', async ({ request }) => {
    const response = await request.get('/torch-config.json');
    expect(response.ok()).toBeTruthy();
    const config = await response.json();
    expect(config.nostrLock.namespace).toBe('test-torch');
    // Security check: Auth should be stripped
    expect(config.dashboard.auth).toBeUndefined();
  });

  test('should shutdown gracefully to save coverage', async ({ request }) => {
    // Attempt to shutdown. It might fail if already down (unlikely in serial).
    try {
      // We don't expect a response because the server dies
      await request.get('/shutdown', { timeout: 1000 }).catch(() => {});
    } catch (e) {
      // Ignore
    }
    // Wait a bit for file write
    await new Promise(resolve => setTimeout(resolve, 2000));
  });
});
