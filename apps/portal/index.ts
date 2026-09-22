import { Hono } from 'hono';
import type { Env } from '../../shared/env';
import { INDEXNOW_KEY } from '../../shared/lib/indexnow';
import { AUTHORED_CSS } from '../../shared/authored/page-css';
import { siteApp } from './web/pages';

/** The public website: the catalogue, the authored pages, robots, media. */
export const portalApp = new Hono<{ Bindings: Env }>();

// Every one of these is linked with `?v=<content hash>`, so a change is a new URL.
const VERSIONED = 'public, max-age=31536000, immutable';

portalApp.get('/assets/strona.css', () =>
  new Response(AUTHORED_CSS, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': VERSIONED,
    },
  }),
);

// IndexNow: wyszukiwarka sprawdza tu, że powiadomienie o zmianie przyszło od nas (`lib/indexnow.ts`).
portalApp.get(`/${INDEXNOW_KEY}.txt`, () => new Response(INDEXNOW_KEY, { headers: { 'content-type': 'text/plain; charset=utf-8' } }));

portalApp.get('/robots.txt', (c) =>
  new Response(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /oauth\nDisallow: /rezerwacja\nSitemap: ${c.env.PUBLIC_BASE_URL}/sitemap.xml\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  ),
);

/** Therapist photos uploaded by an administrator live in R2, when it is bound. */
portalApp.get('/media/:key{.+}', async (c) => {
  if (!c.env.MEDIA) return new Response('Not found', { status: 404 });
  const key = c.req.param('key');
  let object = await c.env.MEDIA.get(key);
  // Thumbnails are written beside their master as `<base>-160.<ext>`, and the
  // catalogue derives that address rather than storing it. A photo uploaded
  // before thumbnails existed has no such object, so serve the master instead
  // of a broken image.
  if (!object) {
    const master = key.replace(/-160(\.[a-z]+)$/, '$1');
    if (master !== key) object = await c.env.MEDIA.get(master);
  }
  if (!object) return new Response('Not found', { status: 404 });
  const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
  // Only image types are ever served back, whatever was stored.
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(type)) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
});

portalApp.route('/', siteApp);
