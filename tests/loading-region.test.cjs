require('./setup.cjs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' });
global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
require('./dom-setup.cjs')(dom.window);
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const { LoadingRegion } = require('../src/components/ui/loading-region.tsx');
const root = createRoot(document.getElementById('app'));
after(async () => { await act(async () => root.unmount()); dom.window.close(); });

test('refresh retains the measured box and mounted scrolling DOM, conceals old values and disables only actions', async t => {
  t.mock.method(dom.window.HTMLElement.prototype, 'getBoundingClientRect', () => ({ width: 800, height: 240 }));
  let clicks = 0;
  const render = (loading, text, error = null) => act(async () => root.render(React.createElement(LoadingRegion, {
    loading, error, label: 'Resultados', key: 'stable',
  }, React.createElement('div', { role: 'region', tabIndex: 0, 'aria-label': 'Lista rolável' },
    React.createElement('button', { onClick: () => clicks++ }, text),
    React.createElement('button', { inert: true }, 'Already unavailable')))));
  await render(false, 'Old data');
  const region = document.querySelector('[data-loading-region]');
  const viewport = document.querySelector('[aria-label="Lista rolável"]');
  const button = viewport.querySelector('button');
  viewport.scrollTop = 90; viewport.scrollLeft = 40;
  await render(true, 'Incoming data');
  assert.equal(region.style.height, '240px');
  assert.equal(document.querySelector('[aria-label="Lista rolável"]'), viewport);
  assert.equal(viewport.querySelector('button'), button);
  assert.equal(viewport.scrollTop, 90); assert.equal(viewport.scrollLeft, 40);
  assert.equal(viewport.hasAttribute('inert'), false);
  assert.equal(button.hasAttribute('inert'), true);
  assert.equal(button.closest('[data-loading-content]').getAttribute('aria-hidden'), 'true');
  const wheel = new dom.window.Event('wheel', { bubbles: true, cancelable: true });
  viewport.dispatchEvent(wheel); assert.equal(wheel.defaultPrevented, false);
  await act(async () => button.click()); assert.equal(clicks, 0);
  region.scrollTop = 80;
  await act(async () => region.dispatchEvent(new dom.window.Event('scroll')));
  assert.match(region.querySelector('[data-loading-placeholder]').style.transform, /80px/);
  await render(false, 'New data');
  assert.equal(region.style.height, '240px', 'response cannot collapse the previously occupied box');
  assert.equal(document.querySelector('[aria-label="Lista rolável"]'), viewport);
  assert.equal(viewport.querySelector('button').hasAttribute('inert'), false);
  assert.equal(viewport.querySelectorAll('button')[1].hasAttribute('inert'), true, 'pre-existing inert state is preserved');
  assert.match(viewport.textContent, /New data/);
  assert.equal(region.querySelector('[data-loading-placeholder]'), null);
  await act(async () => viewport.querySelector('button').click()); assert.equal(clicks, 1);
  await render(false, 'Obsolete result', 'Could not load the new scope');
  assert.equal(region.style.height, '240px');
  assert.equal(viewport.closest('[data-loading-content]').getAttribute('aria-hidden'), 'true');
  assert.match(region.querySelector('[data-loading-placeholder]').textContent, /Could not load/);
});

test('resizing the viewport permits responsive reflow, and another refresh reserves the new size', async t => {
  let width = 900, height = 200;
  t.mock.method(dom.window.HTMLElement.prototype, 'getBoundingClientRect', () => ({ width, height }));
  const render = loading => act(async () => root.render(React.createElement(LoadingRegion, { key: 'responsive', loading, label: 'Responsive result' }, 'Data')));
  await render(true); const region = document.querySelector('[data-loading-region]');
  assert.equal(region.style.height, '', 'the initial hint must not constrain the first result');
  await render(false);
  await render(true); assert.equal(region.style.height, '200px');
  await render(false);
  width = 390; height = 480;
  await act(async () => window.dispatchEvent(new dom.window.Event('resize')));
  assert.equal(region.style.height, '');
  await render(true); assert.equal(region.style.height, '480px');
  await render(false); assert.equal(region.style.height, '480px');
});
