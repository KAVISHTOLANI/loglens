import { expect, test } from '@playwright/test';
import { checkMobile, snap } from './helpers';

test('spot the spike, zoom in, filter to errors, upload a file', async ({ page }) => {
  await page.goto('./');
  await page.waitForTimeout(1200);
  await snap(page, 'landing');
  await checkMobile(page, 'landing-mobile');
  await page.getByRole('link', { name: 'Analyze a log' }).first().click();
  await expect(page.getByRole('img', { name: /Log volume over time/ })).toBeVisible();
  const total = await page.getByTestId('shown').textContent();

  // Click the bar with the most errors
  const bars = page.locator('.tl-col');
  const labels = await bars.evaluateAll((els) => els.map((e) => Number((e.getAttribute('aria-label') ?? '').match(/(\d+) errors/)?.[1] ?? 0)));
  await bars.nth(labels.indexOf(Math.max(...labels))).click();
  await expect(page.getByRole('button', { name: 'Clear time filter' })).toBeVisible();
  await expect(page.getByTestId('shown')).not.toHaveText(total ?? '');
  await page.getByRole('button', { name: 'Errors only' }).click();
  await expect(page.locator('.log-line').first()).toContainText(/ERROR|FATAL/);
  await page.locator('.log-line button').first().click();
  await page.waitForTimeout(400);
  await snap(page, 'analyze');
  await checkMobile(page);

  await page.locator('#file').setInputFiles({ name: 'app.jsonl', mimeType: 'text/plain', buffer: Buffer.from('{"time":"2026-03-04T10:00:00Z","level":"error","msg":"queue stalled","service":"worker"}\n{"time":"2026-03-04T10:01:00Z","level":"info","msg":"queue resumed","service":"worker"}') });
  await expect(page.getByText(/Loaded app.jsonl — 2 lines/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('shown')).toHaveText('2 of 2 shown');
});
