(function () {
  'use strict';

  var progressBar = null;
  var ticking = false;

  function ensureBar() {
    if (progressBar && document.body.contains(progressBar)) return progressBar;
    progressBar = document.querySelector('.bac-reading-progress');
    if (progressBar) return progressBar;
    progressBar = document.createElement('div');
    progressBar.className = 'bac-reading-progress';
    document.body.appendChild(progressBar);
    return progressBar;
  }

  function updateBar() {
    ticking = false;
    var bar = ensureBar();
    var root = document.documentElement;
    var scrollable = Math.max(0, root.scrollHeight - window.innerHeight);
    if (scrollable <= 0) {
      bar.style.width = '0%';
      bar.classList.remove('is-visible');
      return;
    }

    var progress = Math.min(1, Math.max(0, window.scrollY / scrollable));
    bar.style.width = String(progress * 100) + '%';
    if (progress > 0.001 || scrollable > 120) {
      bar.classList.add('is-visible');
    }
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateBar);
  }

  function boot() {
    ensureBar();
    updateBar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  document.addEventListener('pjax:complete', requestUpdate);
  document.addEventListener('pjax:end', requestUpdate);
})();
