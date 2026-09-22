import { Hono } from 'hono';
import type { Env } from '../../shared/env';
import { assetResponse } from '../../shared/web/layout';
import { APP_CSS } from '../../shared/web/styles';
import { ADMIN_CSS, ADMIN_JS } from './web/admin-ui';
import { PANEL_CSS, TOOL_JS } from './authored/panel';
import { adminApp } from './web/admin';
import { therapistSignupApp } from './web/therapist-signup';

/** The therapist panel: /admin, the signup flow and their assets. */
export const panelApp = new Hono<{ Bindings: Env }>();

const CSS = 'text/css; charset=utf-8';
const JS = 'text/javascript; charset=utf-8';

panelApp.get('/assets/app.css', () => assetResponse(APP_CSS, CSS));
panelApp.get('/assets/strona-panel.css', () => assetResponse(PANEL_CSS, CSS));
panelApp.get('/assets/strona-panel.js', () => assetResponse(TOOL_JS, JS));

// Admin-only assets. The panel is noindex and behind a session, but these two
// files carry no data, so they are served like any other static asset.
// `x-content-type-options` comes from the baseline patch in worker.ts.
panelApp.get('/assets/admin.css', () => assetResponse(ADMIN_CSS, CSS));
panelApp.get('/assets/admin.js', () => assetResponse(ADMIN_JS, JS));

panelApp.route('/admin', adminApp);
panelApp.route('/dla-terapeutow', therapistSignupApp);
