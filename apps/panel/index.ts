import { Hono } from 'hono';
import type { Env } from '../../shared/env';
import { APP_CSS } from '../../shared/web/styles';
import { ADMIN_CSS, ADMIN_JS } from './web/admin-ui';
import { PANEL_CSS, TOOL_JS } from './authored/panel';
import { adminApp } from './web/admin';
import { therapistSignupApp } from './web/therapist-signup';

/** The therapist panel: /admin, the signup flow and their assets. */
export const panelApp = new Hono<{ Bindings: Env }>();

// Every one of these is linked with `?v=<content hash>`, so a change is a new URL.
const VERSIONED = 'public, max-age=31536000, immutable';

panelApp.get('/assets/app.css', () =>
  new Response(APP_CSS, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': VERSIONED,
    },
  }),
);

panelApp.get('/assets/strona-panel.css', () => new Response(PANEL_CSS, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': VERSIONED } }));
panelApp.get('/assets/strona-panel.js', () => new Response(TOOL_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': VERSIONED } }));

// Admin-only assets. The panel is noindex and behind a session, but these two
// files carry no data, so they are served like any other static asset.
panelApp.get('/assets/admin.css', () =>
  new Response(ADMIN_CSS, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': VERSIONED,
    },
  }),
);

panelApp.get('/assets/admin.js', () =>
  new Response(ADMIN_JS, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': VERSIONED,
      'x-content-type-options': 'nosniff',
    },
  }),
);

panelApp.route('/admin', adminApp);
panelApp.route('/dla-terapeutow', therapistSignupApp);
