// Browser APIs used by accessible controls, absent from JSDOM's layout-free runtime.
module.exports = function setupDOM(window) {
  for (const name of ['Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLFormElement', 'SVGElement', 'Node', 'NodeFilter', 'Document', 'DocumentFragment', 'ShadowRoot', 'MutationObserver', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent']) {
    global[name] = window[name];
  }
  global.CSS = window.CSS ?? { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`) };
  global.getComputedStyle = window.getComputedStyle.bind(window);
  window.requestAnimationFrame ??= callback => setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame ??= clearTimeout;
  global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  window.matchMedia ??= query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  global.ResizeObserver = window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView ??= function () {};
  window.HTMLElement.prototype.scrollTo ??= function () {};
};
