(function () {
  function highlight() {
    if (!window.Prism) return;
    document.querySelectorAll('pre code[class*="language-"]').forEach(function (code) {
      window.Prism.highlightElement(code);
    });
  }

  document.addEventListener('DOMContentLoaded', highlight, { once: true });
  document.addEventListener('astro:page-load', highlight);
  highlight();
}());
