(function () {
  'use strict';
  var config = window.BAC_Config || {};
  function asBool(value, fallback) { return value === undefined ? fallback : value === true || value === 1 || value === '1'; }
  function preparePrism(root) {
    if (!asBool(config.prismEnabled, true)) return;
    var scope = root && root.querySelectorAll ? root : document;
    var lineNumbersEnabled = asBool(config.lineNumbers, true);

    function normalizeBarePre(pre) {
      if (
        pre.querySelector('code') ||
        pre.closest('.arcaea-mermaid-box') ||
        pre.closest('.arcaea-markmap-box') ||
        pre.classList.contains('arcaea-markmap-source') ||
        pre.classList.contains('mermaid')
      ) return null;

      var langClass = 'language-text';
      var cls = pre.className || '';
      var langMatch = cls.match(/(?:^|\s)(?:language-|lang-)([a-z0-9_+#.-]+)/i);
      if (langMatch) { langClass = 'language-' + langMatch[1].toLowerCase(); }

      var code = document.createElement('code');
      code.className = langClass;
      while (pre.firstChild) { code.appendChild(pre.firstChild); }
      pre.appendChild(code);
      return code;
    }

    scope.querySelectorAll('pre:not([data-bac-prism-normalized="1"])').forEach(function (pre) {
      pre.dataset.bacPrismNormalized = '1';
      normalizeBarePre(pre);
    });

    scope.querySelectorAll('pre code:not([data-bac-prism-ready="1"])').forEach(function (code) {
      var pre = code.closest('pre');
      if (
        !pre ||
        pre.closest('.arcaea-mermaid-box') ||
        pre.closest('.arcaea-markmap-box') ||
        pre.classList.contains('arcaea-markmap-source')
      ) return;

      if (lineNumbersEnabled && !pre.classList.contains('line-numbers')) {
        pre.classList.add('line-numbers');
      }

      if (!/\blanguage-/.test(code.className)) {
        code.classList.add('language-text');
      }

      code.dataset.bacPrismReady = '1';

      if (window.Prism && typeof Prism.highlightElement === 'function') {
        Prism.highlightElement(code);
      }
    });
  }
  window.BAC_Lifecycle.register('prism', ({ root }) => preparePrism(root));
})();
