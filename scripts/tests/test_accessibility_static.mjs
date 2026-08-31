import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'style.css'), 'utf8');

assert.match(html, /<form\b[^>]*id="login-form"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="login-title"[^>]*aria-busy="false"[^>]*onsubmit=/);
assert.match(html, /<label\b[^>]*for="login-pw"[^>]*>비밀번호<\/label>/);
assert.match(html, /id="login-pw"[^>]*aria-describedby="login-help login-error"[^>]*aria-invalid="false"/s);
assert.match(html, /id="login-error"[^>]*role="alert"[^>]*aria-live="assertive"/);
assert.match(html, /<div class="layout" inert aria-hidden="true">/, '로그인 전 본문은 포커스·접근성 트리에서 격리');

assert.match(html, /class="modal-content f-col"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="modal-title"[^>]*tabindex="-1"/);
assert.match(html, /class="cf-modal-content"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="cf-details-header"[^>]*tabindex="-1"/);
assert.match(html, /class="modal-close"[^>]*aria-label="[^"]+"/);
assert.match(html, /class="cf-modal-close"[^>]*aria-label="[^"]+"/);

assert.match(html, /<nav\b[^>]*id="sidebar-menu"[^>]*aria-label="[^"]+"/);
assert.match(html, /id="menu-dashboard"[^>]*aria-current="page"/);
assert.match(html, /id="dash-net-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="dash-net-summary-body"/);

const canvases = [...html.matchAll(/<canvas\b([^>]*)>([\s\S]*?)<\/canvas>/g)];
assert.ok(canvases.length >= 20, `expected at least 20 canvases, found ${canvases.length}`);
for (const [, attrs, fallback] of canvases) {
  const id = attrs.match(/\bid="([^"]+)"/)?.[1] ?? '(unknown)';
  assert.match(attrs, /\brole="img"/, `${id} must expose an image role`);
  assert.match(attrs, /\baria-label="[^"]+"/, `${id} must have an accessible name`);
  assert.ok(fallback.trim().length > 0, `${id} must provide fallback text`);
}

const sourcedScripts = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)];
assert.ok(sourcedScripts.length >= 8);
for (const [, before, src, after] of sourcedScripts) {
  assert.match(`${before} ${after}`, /\bdefer\b/, `${src} must be deferred`);
}
assert.doesNotMatch(html, /code\.highcharts\.com\/(?:stock\/highstock|highcharts-more|modules\/treemap)\.js/);
assert.match(html, /code\.highcharts\.com\/stock\/13\.0\.1\/highstock\.js/);
for (const src of [
  'code.highcharts.com/stock/13.0.1/highstock.js',
  'code.highcharts.com/13.0.1/highcharts-more.js',
  'code.highcharts.com/13.0.1/modules/treemap.js',
]) {
  const escaped=src.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(html,new RegExp(`${escaped}[^>]+integrity="sha384-[^"]+"[^>]+crossorigin="anonymous"`),`${src} must use SRI`);
}
assert.match(html, /cdnjs\.cloudflare\.com[^>]+integrity="sha384-[^"]+"[^>]+crossorigin="anonymous"/);
assert.match(html, /cdn\.plot\.ly[^>]+integrity="sha384-[^"]+"[^>]+crossorigin="anonymous"/);

assert.doesNotMatch(html, /<(?:div|span|th|tr|li|a)\b[^>]*\bonclick=/i);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
assert.match(css, /@media\s*\(pointer:coarse\)/);
assert.match(css, /@media\s*\(max-width:400px\)[\s\S]*?#login-overlay[\s\S]*?padding/);

console.log(`PASS: static accessibility and loading checks (${canvases.length} canvases)`);
