import { expect, test } from '@playwright/test';
import { WIDGET_HTML } from '../src/widget/generated';

/**
 * The widget is exercised exactly the way a host exercises it: the document is
 * loaded standalone and fed a tool result over the MCP Apps `ui/*` bridge.
 * Nothing here talks to the server, which is the point - the widget renders
 * only what a tool handed it.
 */

const SEARCH_RESULT = {
  view: 'therapist_list',
  title: 'Dopasowane profile',
  data: {
    results: [
      {
        therapist_id: 'th_1',
        display_name: 'Anna Kowalczyk (DEMO)',
        headline: 'Psychoterapeutka poznawczo-behawioralna',
        profile_url: 'https://otwartyterapeuta.pl/terapeuci/anna',
        cities: ['Warszawa'],
        offers_online: true,
        offers_in_person: true,
        languages: ['pl', 'en'],
        topics: ['lęk i niepokój'],
        modalities: ['CBT'],
        accepting_new_clients: true,
        verification_status: 'verified',
        price_display: '220,00 zł',
        next_available_slot_utc: '2026-09-01T08:00:00Z',
        is_demo: true,
        match_reasons: ['pracuje z obszarami: lęk i niepokój', 'prowadzi sesje online'],
      },
      {
        therapist_id: 'th_2',
        // Hostile content: must be rendered as text, never as markup, and the
        // javascript: link must not become a link at all.
        display_name: '<img src=x onerror=alert(1)>',
        headline: null,
        profile_url: 'javascript:alert(1)',
        cities: [],
        offers_online: true,
        offers_in_person: false,
        languages: ['pl'],
        topics: [],
        modalities: [],
        accepting_new_clients: false,
        verification_status: 'unverified',
        price_display: '150,00 zł',
        next_available_slot_utc: null,
        is_demo: true,
        match_reasons: [],
      },
    ],
    disclaimer: 'Wyniki to profile pasujące do podanych kryteriów, a nie rekomendacja kliniczna.',
  },
};

const SLOTS_RESULT = {
  view: 'slots',
  title: 'Wolne terminy',
  data: {
    slots: [
      {
        slot_id: 'sl_abc',
        local_start: 'wtorek, 1 września 2026, 10:00',
        local_timezone_label: 'GMT+2',
        duration_minutes: 50,
        mode: 'online',
        price_display: '220,00 zł',
      },
    ],
    fresh_until_utc: new Date(Date.now() + 60_000).toISOString(),
    freshness_note: 'Dostępność zmienia się na bieżąco.',
  },
};

async function openWidget(page: import('@playwright/test').Page): Promise<void> {
  await page.route('https://widget.test/index.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: WIDGET_HTML }),
  );
  await page.goto('https://widget.test/index.html');
}

async function deliver(page: import('@playwright/test').Page, payload: unknown): Promise<void> {
  await page.evaluate((structuredContent) => {
    window.postMessage(
      { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent } },
      '*',
    );
  }, payload);
}

test('shows a loading state until a tool result arrives', async ({ page }) => {
  await openWidget(page);
  await expect(page.getByRole('status').filter({ hasText: 'Wczytuję dane' })).toBeVisible();
});

test('renders a therapist list with explainable match reasons', async ({ page }) => {
  await openWidget(page);
  await deliver(page, SEARCH_RESULT);

  await expect(page.getByRole('heading', { name: 'Dopasowane profile' })).toBeVisible();
  await expect(page.getByText('Anna Kowalczyk (DEMO)')).toBeVisible();
  await expect(page.getByText('Pasuje do podanych kryteriów, ponieważ:').first()).toBeVisible();
  await expect(page.getByText('pracuje z obszarami: lęk i niepokój')).toBeVisible();
  await expect(page.getByText('profil zweryfikowany').first()).toBeVisible();
  await expect(page.getByText('dane demonstracyjne').first()).toBeVisible();
});

test('treats tool data as untrusted: no HTML injection, no unsafe links', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await openWidget(page);
  await deliver(page, SEARCH_RESULT);

  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(await page.locator('img').count()).toBe(0);
  expect(dialogs).toEqual([]);

  const hrefs = await page.locator('a').evaluateAll((nodes) =>
    nodes.map((n) => (n as HTMLAnchorElement).getAttribute('href')),
  );
  expect(hrefs.every((h) => h === null || h.startsWith('https://') || h.startsWith('mailto:'))).toBe(true);
});

test('announces view changes to assistive technology', async ({ page }) => {
  await openWidget(page);
  await deliver(page, SEARCH_RESULT);
  const live = page.locator('[aria-live="polite"]');
  await expect(live).toHaveText(/lista terapeutów/);
});

test('slots are reachable and operable with the keyboard alone', async ({ page }) => {
  await openWidget(page);
  await deliver(page, SLOTS_RESULT);

  await expect(page.getByRole('button', { name: /wtorek, 1 września 2026/ })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button').first()).toBeFocused();

  const outline = await page
    .getByRole('button')
    .first()
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});

test('shows a stale-data warning once the freshness horizon has passed', async ({ page }) => {
  await openWidget(page);
  await deliver(page, {
    ...SLOTS_RESULT,
    data: { ...SLOTS_RESULT.data, fresh_until_utc: '2020-01-01T00:00:00Z' },
  });
  await expect(page.getByText('Te terminy mogły się zmienić.')).toBeVisible();
});

test('says there is no approved answer instead of inventing one', async ({ page }) => {
  await openWidget(page);
  await deliver(page, {
    view: 'faq',
    title: 'FAQ',
    data: { items: [], no_approved_answer: true, usage_note: '' },
  });
  await expect(page.getByRole('heading', { name: 'Brak zatwierdzonej odpowiedzi' })).toBeVisible();
  await expect(page.getByText('skontaktuj się bezpośrednio z terapeutą', { exact: false })).toBeVisible();
});

test('booking summary shows every fact before the confirm button', async ({ page }) => {
  await openWidget(page);
  await deliver(page, {
    view: 'booking_summary',
    title: 'Podsumowanie',
    data: {
      confirmation_token: 'token',
      summary: {
        therapist_name: 'Anna Kowalczyk (DEMO)',
        local_start: 'wtorek, 1 września 2026, 10:00',
        local_timezone_label: 'GMT+2',
        duration_minutes: 50,
        session_type_label: 'indywidualne',
        mode_label: 'online',
        price_display: '220,00 zł',
        cancellation_policy: 'Bezpłatne odwołanie do 24 godzin przed sesją.',
        terms_version: '2026-08-01',
        privacy_version: '2026-08-01',
        terms_url: 'https://otwartyterapeuta.pl/regulamin',
        privacy_url: 'https://otwartyterapeuta.pl/polityka-prywatnosci',
      },
    },
  });

  for (const fact of ['Anna Kowalczyk (DEMO)', '220,00 zł', '50 min', 'GMT+2', 'indywidualne']) {
    await expect(page.getByText(fact, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Potwierdzam i rezerwuję' })).toBeVisible();
});

test('always carries the crisis and scope disclaimer', async ({ page }) => {
  await openWidget(page);
  await deliver(page, SEARCH_RESULT);
  await expect(page.getByText('nie jest terapią ani pomocą w nagłym zagrożeniu', { exact: false })).toBeVisible();
  await expect(page.getByText('112', { exact: false }).first()).toBeVisible();
});
