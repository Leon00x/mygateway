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

test('console follows the system theme until the user overrides it and API docs inherit the active theme', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('mygateway.theme'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const docsLink = page.locator('.topbar-actions a[href^="/v1/api-docs"]');
  await expect(docsLink).toHaveAttribute('href', '/v1/api-docs?theme=dark');
  await expect(page.locator('.shortcut-panel a[href^="/v1/api-docs"]'))
    .toHaveAttribute('href', '/v1/api-docs?theme=dark');
  expect(await (await page.request.get('/v1/api-docs?theme=dark')).text()).toMatch(/"darkMode":\s*true/);

  await page.getByRole('button', { name: '切换到浅色模式' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.topbar-actions a[href^="/v1/api-docs"]'))
    .toHaveAttribute('href', '/v1/api-docs?theme=light');
});

test('system page validates and applies the canonical website URL', async ({ page }) => {
  await page.goto('/system');
  const accountCard = page.locator('.account-settings-card');
  const publicUrlCard = page.locator('.public-url-card');
  await expect(publicUrlCard.getByRole('heading', { name: '网站访问域名' })).toBeVisible();

  const [accountBox, publicUrlBox] = await Promise.all([accountCard.boundingBox(), publicUrlCard.boundingBox()]);
  expect(accountBox).not.toBeNull();
  expect(publicUrlBox).not.toBeNull();
  expect(Math.abs(accountBox!.y - publicUrlBox!.y)).toBeLessThan(2);

  const invalidResponse = await page.request.put('/admin/api/system/public-url', {
    data: { public_url: 'https://gateway.example.test/admin' },
  });
  expect(invalidResponse.status()).toBe(400);

  const input = publicUrlCard.getByRole('textbox', { name: '规范访问地址' });
  await input.fill('https://Gateway.Example.test/');
  await publicUrlCard.getByRole('button', { name: '保存' }).click();
  await expect(publicUrlCard.getByRole('status')).toContainText('已保存');

  const setting = await page.request.get('/admin/api/system/public-url').then((response) => response.json());
  expect(setting.public_url).toBe('https://gateway.example.test');
  await expect(page.locator('.management-reveal pre')).toContainText('Install the mygateway-admin skill from https://gateway.example.test/skill.md');
  await expect(page.locator('.management-reveal pre')).not.toContainText('Before every use');
  await expect(page.locator('.management-reveal pre')).toContainText('MYGATEWAY_URL=https://gateway.example.test');

  await page.goto('/console');
  await expect(page.locator('.endpoint-body code').first()).toContainText('https://gateway.example.test/v1');
});

test('system page creates a management key and keeps the one-time Agent prompt after refresh', async ({ page }) => {
  const keyName = `Playwright Agent ${Date.now()}`;
  await page.goto('/system');
  const card = page.locator('.management-card');
  await expect(card.getByRole('heading', { name: '管理密钥与 Skill' })).toBeVisible();
  const defaultPrompt = card.locator('.management-reveal pre');
  await expect(defaultPrompt).toContainText('Install the mygateway-admin skill from http://localhost:8799/skill.md');
  await expect(defaultPrompt).not.toContainText('Before every use');
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
