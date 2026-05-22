const { test, expect } = require('@playwright/test');

// Mobile viewport sizes
const MOBILE_VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 12', width: 390, height: 844 },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
  { name: 'Samsung Galaxy S20', width: 360, height: 800 },
  { name: 'Pixel 5', width: 393, height: 851 },
];

// Tablet viewport sizes
const TABLET_VIEWPORTS = [
  { name: 'iPad Mini', width: 768, height: 1024 },
  { name: 'iPad Air', width: 820, height: 1180 },
];

const BASE_URL = 'http://localhost:3000';

test.describe('Mobile UI Reality Check', () => {

  // Test each mobile viewport
  for (const viewport of MOBILE_VIEWPORTS) {
    test(`[${viewport.name}] (${viewport.width}x${viewport.height}) - page loads and renders correctly`, async ({ page }) => {
      // Register console error listener BEFORE navigation
      const consoleErrors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(BASE_URL);

      // Wait for content to load (API data fetch)
      await page.waitForSelector('.content', { timeout: 15000 });

      // Check if movie cards exist; if not, expect empty state
      const cardCount = await page.locator('.movie-card').count();
      if (cardCount === 0) {
        const emptyState = page.locator('.empty-state, #globalEmpty');
        await expect(emptyState.first()).toBeVisible({ timeout: 5000 });
      }

      // Verify no horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10); // Allow 10px tolerance

      // Verify header is visible and readable
      const header = page.locator('.header');
      await expect(header).toBeVisible();
      const headerTitle = page.locator('.header__title');
      await expect(headerTitle).toBeVisible();

      // Verify theme toggle is accessible
      const themeToggle = page.locator('#themeToggle');
      await expect(themeToggle).toBeVisible();

      // Verify footer is visible
      const footer = page.locator('.footer');
      await expect(footer).toBeVisible();

      // Wait a bit for any delayed console errors
      await page.waitForTimeout(2000);
      const filteredErrors = consoleErrors.filter(err =>
        !err.includes('TMDB') && !err.includes('404') && !err.includes('CORS')
      );
      expect(filteredErrors).toHaveLength(0);
    });

    test(`[${viewport.name}] - movie cards render with correct layout`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(BASE_URL);
      await page.waitForSelector('.content', { timeout: 15000 });

      const cards = page.locator('.movie-card');
      const cardCount = await cards.count();

      if (cardCount > 0) {
        // On mobile (max-width: 768px CSS breakpoint), cards should be in vertical layout
        const firstCard = cards.first();
        const cardBox = await firstCard.evaluate(el => {
          const style = window.getComputedStyle(el);
          return {
            flexDirection: style.flexDirection,
          };
        });

        // CSS breakpoint is max-width: 768px, so all mobile viewports (<768) get column
        if (viewport.width < 768) {
          expect(cardBox.flexDirection).toBe('column');
        }

        // Poster should be visible and have reasonable size
        const poster = firstCard.locator('.movie-card__poster-wrap, .movie-card__poster--placeholder');
        await expect(poster).toBeVisible();
      }
    });

    test(`[${viewport.name}] - tags and badges are readable`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(BASE_URL);
      await page.waitForSelector('.content', { timeout: 15000 });

      const tags = page.locator('.movie-tag');
      const tagCount = await tags.count();
      if (tagCount > 0) {
        // Tags should not overflow their container
        for (let i = 0; i < Math.min(tagCount, 20); i++) {
          const tag = tags.nth(i);
          const box = await tag.evaluate(el => {
            const style = window.getComputedStyle(el);
            return {
              fontSize: parseFloat(style.fontSize),
            };
          });
          expect(box.fontSize).toBeGreaterThanOrEqual(10); // Minimum readable size
        }
      }
    });
  }

  // Test tablet viewports
  for (const viewport of TABLET_VIEWPORTS) {
    test(`[${viewport.name}] (${viewport.width}x${viewport.height}) - page loads correctly`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(BASE_URL);
      await page.waitForSelector('.content', { timeout: 15000 });

      // Verify content is visible
      const content = page.locator('.content');
      await expect(content).toBeVisible();
    });
  }

  // Desktop viewport test
  test('Desktop (1280x800) - horizontal card layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE_URL);
    await page.waitForSelector('.content', { timeout: 15000 });

    const cards = page.locator('.movie-card');
    if (await cards.count() > 0) {
      const firstCard = cards.first();
      const cardBox = await firstCard.evaluate(el => {
        const style = window.getComputedStyle(el);
        return { flexDirection: style.flexDirection };
      });
      // On desktop, cards should be horizontal (poster left, content right)
      expect(cardBox.flexDirection).toBe('row');
    }
  });

  // Dark/Light mode toggle test
  test('Theme toggle works on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE_URL);
    await page.waitForSelector('#themeToggle', { timeout: 10000 });

    // Default should be dark mode (no .light class)
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/light/);

    // Click toggle
    await page.locator('#themeToggle').click();

    // Should switch to light mode
    await expect(html).toHaveClass(/light/);

    // Click again to go back to dark
    await page.locator('#themeToggle').click();
    await expect(html).not.toHaveClass(/light/);
  });

  // Language group collapse test
  test('Language groups collapse/expand on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE_URL);
    await page.waitForSelector('.lang-group__header', { timeout: 10000 });

    const headers = page.locator('.lang-group__header');
    if (await headers.count() > 0) {
      // Click to collapse
      await headers.first().click();

      // Wait for transition to complete
      await page.waitForTimeout(500);

      const grid = page.locator('.lang-group__grid').first();
      await expect(grid).toHaveClass(/lang-group__grid--collapsed/);

      // Click to expand
      await headers.first().click();
      await page.waitForTimeout(500);
      await expect(grid).not.toHaveClass(/lang-group__grid--collapsed/);
    }
  });
});