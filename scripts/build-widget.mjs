#!/usr/bin/env node
/**
 * Bundles the React widget into ONE self-contained HTML document and writes it
 * to `src/widget/generated.ts` as a plain string export.
 *
 * Self-contained is a hard requirement: the MCP Apps resource is served with a
 * strict CSP that allows no external script, style, font or image origin, so
 * every byte the widget needs has to be inside this document.
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
  entryPoints: [resolve(root, 'src/widget/main.tsx')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  platform: 'browser',
  minify: true,
  write: false,
  jsx: 'automatic',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

const js = result.outputFiles?.[0]?.text ?? '';
if (js.length === 0) throw new Error('esbuild nie wyprodukował bundla widgetu.');

const css = await readFile(resolve(root, 'src/widget/widget.css'), 'utf8');

const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Otwarty Terapeuta</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;

const outPath = resolve(root, 'src/widget/generated.ts');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(
  outPath,
  `/* GENERATED FILE - do not edit. Produced by scripts/build-widget.mjs. */\n` +
    `/* eslint-disable */\n` +
    `export const WIDGET_HTML = ${JSON.stringify(html)};\n` +
    `export const WIDGET_BYTES = ${html.length};\n`,
  'utf8',
);

console.log(`widget: ${(html.length / 1024).toFixed(1)} kB -> src/widget/generated.ts`);
