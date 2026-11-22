(function () {
  'use strict';

  var COLLAPSE_AFTER_LINES = 24;
  var VISIBLE_LINES = 18;

  function getPre(shell) {
    return shell.querySelector('pre[class*="language-"]');
  }

  function getShell(pre) {
    return pre.closest('.bac-code-shell');
  }

  function countLines(pre) {
    var code = pre.querySelector('code');
    var text = code ? code.textContent : pre.textContent;
    if (!text) return 0;
    return text.replace(/\n$/, '').split('\n').length;
  }

  function computeCollapseHeight(pre) {
    var styles = window.getComputedStyle(pre);
    var lineHeight = parseFloat(styles.lineHeight) || 25.5;
    var paddingTop = parseFloat(styles.paddingTop) || 0;
    var paddingBottom = parseFloat(styles.paddingBottom) || 0;
    return Math.round(lineHeight * VISIBLE_LINES + paddingTop + paddingBottom);
  }

  function ensureToggle(shell, pre, lineCount) {
    if (shell.querySelector('.bac-code-fold-toggle')) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'bac-code-fold-toggle';
    button.textContent = '展开完整代码';
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', function () {
      var collapsed = shell.classList.toggle('bac-code-collapsed');
      button.textContent = collapsed ? '展开完整代码' : '收起代码';
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });

    shell.classList.add('bac-code-collapsible', 'bac-code-collapsed');
    shell.style.setProperty('--bac-code-collapse-height', String(computeCollapseHeight(pre)) + 'px');
    shell.appendChild(button);
    shell.dataset.bacCodeLines = String(lineCount);
  }

  function decorate(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.bac-code-shell').forEach(function (shell) {
      var pre = getPre(shell);
      if (!pre) return;

      var lineCount = countLines(pre);
      if (lineCount <= COLLAPSE_AFTER_LINES) {
        pre.dataset.bacFoldReady = '1';
        return;
      }

      shell.style.setProperty('--bac-code-collapse-height', String(computeCollapseHeight(pre)) + 'px');
      if (pre.dataset.bacFoldReady !== '1') {
        ensureToggle(shell, pre, lineCount);
        pre.dataset.bacFoldReady = '1';
      }
    });
  }

  window.BAC_Lifecycle.register('prism:fold', ({ root, signal, cleanup }) => {
    decorate(root);
    let frame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => decorate(root));
    }, { signal });
    cleanup(() => cancelAnimationFrame(frame));
  });
})();
