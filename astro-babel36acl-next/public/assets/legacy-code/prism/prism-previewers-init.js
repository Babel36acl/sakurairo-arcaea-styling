(function () {
  'use strict';

  function markState(state) {
    document.documentElement.setAttribute('data-bac-prism-previewers', state);
  }

  function checkPreviewers() {
    var prism = window.Prism;
    var ready = !!(prism && prism.plugins && prism.plugins.Previewer);
    markState(ready ? 'ready' : 'missing');
    if (!ready) {
      console.warn('[Babel Arcaea Code] Prism Previewers unavailable: prism-previewers.js may not have initialized correctly.');
    }
  }

  window.BAC_Lifecycle.register('prism:previewers', checkPreviewers);
})();
