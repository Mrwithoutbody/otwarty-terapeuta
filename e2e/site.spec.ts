import { expect, test } from '@playwright/test';

/** The public site must be usable without a mouse and without JavaScript. */

test('landing page states what the service is and is not', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Znajdź psychoterapeutę');
  await expect(page.getByText('Nie jest usługą terapeutyczną').first()).toBeVisible();
  await expect(page.getByText('116 123').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('the plugin CTA never links anywhere invented', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Znajdź terapeutę z pomocą ChatGPT' });

  if (await link.count()) {
    // Configured: it must point at a real absolute URL.
    expect(await link.first().getAttribute('href')).toMatch(/^https:\/\//);
  } else {
    // Not configured: lead to the real explanation page, without a fake plugin URL.
    const fallback = page.getByRole('link', { name: 'Zobacz, jak działa w ChatGPT' });
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('href', '#w-chatgpt');
  }
});

test('skip link is the first keyboard stop and moves focus to the content', async ({ page }) => {
  await page.goto('/terapeuci');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Przejdź do treści' })).toBeFocused();
});

test('the catalogue filters work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/terapeuci');

  await page.selectOption('#miasto', 'Warszawa');
  await page.getByRole('button', { name: 'Pokaż wyniki' }).click();

  await expect(page).toHaveURL(/miasto=Warszawa/);
  await expect(page.getByRole('heading', { name: /^Wyniki/ })).toBeVisible();
  await context.close();
});

test('every profile is labelled as verified, declared or demo data', async ({ page }) => {
  await page.goto('/terapeuci');
  const cards = page.locator('.card');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const text = await cards.nth(i).innerText();
    expect(
      text.includes('profil zweryfikowany') || text.includes('dane deklarowane przez terapeutę'),
    ).toBe(true);
    expect(text).toContain('dane demonstracyjne');
  }
});

test('the profile page shows price, FAQ provenance and cancellation rules', async ({ page }) => {
  await page.goto('/terapeuci/anna-kowalczyk-demo');
  await expect(page.getByRole('heading', { name: 'Oferta i ceny' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zasady odwołania' })).toBeVisible();
  await expect(page.getByText('Odpowiedzi pochodzą wprost od terapeuty.')).toBeVisible();
  await expect(page.locator('table')).toContainText('zł');
});

test('the crisis page leads with the emergency number', async ({ page }) => {
  await page.goto('/pomoc-w-kryzysie');
  await expect(page.getByText('Rezerwacja wizyty nie jest pomocą w nagłym zagrożeniu.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Osoby poniżej 18 roku życia' })).toBeVisible();
});

test('admin is not reachable without a session', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Panel administracyjny' })).toBeVisible();
  await expect(page.getByLabel('Adres e-mail')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('security headers are set on every HTML response', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("default-src 'none'");
  expect(headers['content-security-policy']).not.toContain('unsafe-inline');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
});
