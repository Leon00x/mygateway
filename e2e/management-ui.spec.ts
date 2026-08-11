import { expect, test } from '@playwright/test';
import { loginViaUi, resetState } from './helpers';

test.beforeEach(async ({ page }) => {
  await resetState(page.request);
  await page.context().clearCookies();
  await loginViaUi(page);
});

test.afterEach(async ({ page }) => {
  await resetState(page.request);
});

test('system page creates a management key and keeps the one-time Agent prompt after refresh', async ({ page }) => {
  const keyName = `Playwright Agent ${Date.now()}`;
  await page.goto('/system');
  const card = page.locator('.management-card');
  await expect(card.getByRole('heading', { name: '管理密钥与 Skill' })).toBeVisible();
  const defaultPrompt = card.locator('.management-reveal pre');
  await expect(defaultPrompt).toContainText('Read http://localhost:8799/skill.md and follow the instructions to manage MyGateway.');
  await expect(defaultPrompt).toContainText('MYGATEWAY_MANAGEMENT_KEY=mgmt_YOUR_MANAGEMENT_KEY');
  await expect(card.locator('.management-create-panel')).toHaveCount(0);
  expect(await card.locator('.management-key-row').count()).toBeLessThanOrEqual(3);
  await card.getByRole('button', { name: '创建管理密钥' }).click();
  await expect(card.locator('.management-create-panel')).toBeVisible();
  await card.locator('.management-create input').fill(keyName);
  await card.locator('.management-create select').nth(1).selectOption('permanent');
  await card.getByRole('button', { name: '创建管理密钥' }).click();

  const prompt = card.locator('.management-reveal pre');
  await expect(prompt).toContainText(/MYGATEWAY_MANAGEMENT_KEY=mgmt_[A-Za-z0-9_-]{20,}/);
  const beforeRefresh = await prompt.textContent();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mygateway.management-key.reveal.v1'))).not.toBeNull();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mygateway.management-key.reveal.v1')!));
  expect(stored.key).toMatch(/^mgmt_/);
  expect(stored.show_until).toBeLessThanOrEqual(Date.now() + 3_600_000);

  await page.reload();
  await expect(card.locator('.management-reveal pre')).toHaveText(beforeRefresh!);
  await expect(card.getByText(keyName, { exact: true })).toBeVisible();
  const keyRow = card.locator('.management-key-row').filter({ hasText: keyName });
  await expect(keyRow).toContainText('永久');
  const status = keyRow.locator('.management-status');
  await expect(status).toContainText('运行中');
  expect(await status.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: '切换到暗黑模式' }).click();
  expect(await status.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(keyRow.getByRole('button', { name: '重置' })).toHaveCount(0);
  await expect(keyRow).not.toContainText('已撤销');
  await expect(card.locator('.management-create-panel')).toHaveCount(0);

  const listToggle = card.locator('.management-list-toggle');
  if (await listToggle.count()) {
    await listToggle.click();
    expect(await card.locator('.management-key-row').count()).toBeGreaterThan(3);
  }

  await page.evaluate(() => {
    const storageKey = 'mygateway.management-key.reveal.v1';
    const value = JSON.parse(localStorage.getItem(storageKey)!);
    localStorage.setItem(storageKey, JSON.stringify({ ...value, show_until: Date.now() - 1 }));
  });
  await page.reload();
  await expect(card.locator('.management-reveal')).not.toHaveClass(/active/);
  await expect(card.locator('.management-reveal pre')).toContainText('MYGATEWAY_MANAGEMENT_KEY=mgmt_YOUR_MANAGEMENT_KEY');

  await card.locator('.management-key-row').filter({ hasText: keyName }).getByRole('button', { name: '删除' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: '确定' }).click();
  await expect(card.locator('.management-key-row').filter({ hasText: keyName })).toHaveCount(0);
  await expect(card.locator('.management-reveal')).toBeVisible();
  await expect(card.locator('.management-reveal')).not.toHaveClass(/active/);
  await expect(card.locator('.management-reveal pre')).toContainText('MYGATEWAY_MANAGEMENT_KEY=mgmt_YOUR_MANAGEMENT_KEY');
});
