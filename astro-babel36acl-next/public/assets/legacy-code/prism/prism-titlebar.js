(function () {
  'use strict';

  function getContainer(pre) {
    return pre.parentElement && pre.parentElement.classList.contains('code-toolbar')
      ? pre.parentElement
      : pre;
  }

  function getShell(container) {
    var shell = container.parentElement;
    if (shell && shell.classList.contains('bac-code-shell')) return shell;

    shell = document.createElement('div');
    shell.className = 'bac-code-shell';
    container.parentNode.insertBefore(shell, container);
    shell.appendChild(container);
    return shell;
  }

  function decorateCodeBlocks(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('pre[class*="language-"]:not(.mermaid):not(.arcaea-markmap-source)').forEach(function (pre) {
      if (pre.closest('.arcaea-mermaid-box') || pre.closest('.arcaea-markmap-box')) return;

      var container = getContainer(pre);
      var shell = getShell(container);
      shell.querySelectorAll('.bac-code-titlebar').forEach(function (titlebar) {
        titlebar.remove();
      });
      delete shell.dataset.bacCodeLanguage;
    });
  }

  window.BAC_Lifecycle.register('prism:titlebar', ({ root, signal, cleanup }) => {
    decorateCodeBlocks(root);
  });
})();
