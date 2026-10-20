require('./setup.cjs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
require('./dom-setup.cjs')(dom.window);
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const { Select } = require('../src/components/ui/select.tsx');
const { DatePicker } = require('../src/components/ui/date-picker.tsx');
const root = createRoot(document.getElementById('app'));
after(async () => { await act(async () => root.unmount()); dom.window.close(); });
const click = element => act(async () => element.click());
const key = (element, value) => act(async () => {
  element.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true }));
  element.dispatchEvent(new window.KeyboardEvent('keyup', { key: value, bubbles: true }));
});

test('themed select renders its own menu, supports an empty filter and keeps form values', async () => {
  const changed = [];
  function Preview() {
    const [value, setValue] = React.useState('');
    return React.createElement('form', null, React.createElement(Select, {
      label: 'Pagamento', name: 'payment', value, onValueChange: value => { changed.push(value); setValue(value); },
    }, React.createElement('option', { value: '' }, 'Todos'), React.createElement('option', { value: 'paid' }, 'Pago'), React.createElement('option', { value: 'blocked', disabled: true }, 'Bloqueado')));
  }
  await act(async () => root.render(React.createElement(Preview)));
  const trigger = () => document.querySelector('.app-select-trigger');
  assert.match(trigger().textContent, /Todos/);
  await click(trigger());
  assert.ok(document.querySelector('[role="listbox"]'));
  assert.equal(document.querySelector('[role="option"][data-key="blocked"]').getAttribute('aria-disabled'), 'true');
  await click(document.querySelector('[role="option"][data-key="paid"]'));
  assert.deepEqual(changed, ['paid']);
  assert.match(trigger().textContent, /Pago/);
  assert.equal(new window.FormData(document.querySelector('form')).get('payment'), 'paid');
  await click(trigger());
  await click(document.querySelector('[role="option"][data-key=""]'));
  assert.deepEqual(changed, ['paid', '']);
  assert.match(trigger().textContent, /Todos/);
  await click(trigger());
  await key(document.querySelector('[role="listbox"]'), 'Escape');
  assert.equal(document.querySelector('[role="listbox"]'), null);
});

test('calendar uses Portuguese dates, blocks dates outside the range and submits ISO dates', async () => {
  const changed = [];
  function Preview() {
    const [value, setValue] = React.useState('2026-09-15');
    return React.createElement('form', null, React.createElement(DatePicker, {
      label: 'De', name: 'from', value, min: '2026-09-10', max: '2026-09-20', required: true,
      onValueChange: value => { changed.push(value); setValue(value); },
    }));
  }
  await act(async () => root.render(React.createElement(Preview)));
  assert.match(document.querySelector('.app-date-input').textContent, /15\/09\/2026/);
  await click(document.querySelector('.app-calendar-trigger'));
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.match(document.querySelector('.app-calendar-caption .app-select-trigger').textContent, /set\./);
  const days = () => [...document.querySelectorAll('.app-calendar-day')];
  assert.equal(days().find(day => day.textContent === '9' && !day.hasAttribute('data-outside-month')).getAttribute('aria-disabled'), 'true');
  assert.equal(document.querySelector('.app-calendar-actions').textContent, 'Hoje');
  assert.equal(document.querySelector('.app-calendar-actions button').disabled, true);
  await click(days().find(day => day.textContent === '18' && !day.hasAttribute('data-outside-month')));
  assert.deepEqual(changed, ['2026-09-18']);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(new window.FormData(document.querySelector('form')).get('from'), '2026-09-18');
  const daySegment = document.querySelector('[data-type="day"]');
  await act(async () => daySegment.focus());
  await key(daySegment, 'ArrowUp');
  assert.equal(changed.at(-1), '2026-09-19');
});

test('optional calendars can clear and disabled controls cannot open menus', async () => {
  function Preview({ disabled = false }) {
    const [value, setValue] = React.useState('2026-09-15');
    return React.createElement(React.Fragment, null,
      React.createElement(DatePicker, { label: 'Até', value, onValueChange: setValue, disabled }),
      React.createElement(Select, { label: 'Perfil', value: 'operator', onValueChange() {}, disabled }, React.createElement('option', { value: 'operator' }, 'Operador')));
  }
  await act(async () => root.render(React.createElement(Preview)));
  await click(document.querySelector('.app-calendar-trigger'));
  await click([...document.querySelectorAll('.app-calendar-actions button')].find(button => button.textContent === 'Limpar'));
  assert.equal(document.querySelector('.app-date-picker input').value, '');
  await act(async () => root.render(React.createElement(Preview, { disabled: true })));
  assert.equal(document.querySelector('.app-calendar-trigger').disabled, true);
  assert.equal(document.querySelector('.app-select-trigger').disabled, true);
  await click(document.querySelector('.app-calendar-trigger'));
  await click(document.querySelector('.app-select-trigger'));
  assert.equal(document.querySelector('[role="dialog"], [role="listbox"]'), null);
});

test('calendar month and year menus navigate without selecting a different date prematurely', async () => {
  const changed = [];
  function Preview() {
    const [value, setValue] = React.useState('2026-09-15');
    return React.createElement(DatePicker, { label: 'Venda', value, onValueChange: value => { changed.push(value); setValue(value); } });
  }
  await act(async () => root.render(React.createElement(Preview)));
  await click(document.querySelector('.app-calendar-trigger'));
  await click(document.querySelectorAll('.app-calendar-caption .app-select-trigger')[0]);
  await click([...document.querySelectorAll('[role="option"]')].find(option => option.textContent === 'out.'));
  assert.match(document.querySelectorAll('.app-calendar-caption .app-select-trigger')[0].textContent, /out\./);
  await click(document.querySelectorAll('.app-calendar-caption .app-select-trigger')[1]);
  await click([...document.querySelectorAll('[role="option"]')].find(option => option.textContent === '2030'));
  assert.deepEqual(changed, []);
  await click([...document.querySelectorAll('.app-calendar-day')].find(day => day.textContent === '8' && !day.hasAttribute('data-outside-month')));
  assert.deepEqual(changed, ['2030-10-08']);
});
