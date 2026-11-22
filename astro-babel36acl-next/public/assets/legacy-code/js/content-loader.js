/* Rendered content owns module requirements, including after PJAX replacement. */
(function () {
  'use strict';
  const manifest = window.BAC_Assets;
  if (!manifest || window.BAC_ContentLoader) return;
  window.BAC_ContentLoader = true;
  const pending = new Map();
  const modules = new Map();
  let current = null;
  let work = Promise.resolve();
  window.BAC_Lifecycle = { register(name, mount) { modules.set(name, mount); } };

  function leave() {
    if (!current) return;
    current.controller.abort();
    for (const cleanup of current.cleanups.reverse()) {
      try { cleanup(); } catch (error) { console.warn('[Babel Arcaea Code]', error); }
    }
    current = null;
  }
  function inline(source) {
    const script = document.createElement('script');
    script.textContent = source;
    document.head.appendChild(script);
    script.remove();
  }
  function load(kind, handle) {
    const key = kind + ':' + handle;
    if (pending.has(key)) return pending.get(key);
    const asset = manifest[kind][handle];
    // Dependencies already enqueued outside the manifest remain WordPress-owned.
    if (!asset) return Promise.resolve();
    const promise = Promise.all(asset.deps.map(dep => load(kind, dep))).then(() => new Promise((resolve, reject) => {
      asset.before.forEach(inline);
      const element = document.createElement(kind === 'scripts' ? 'script' : 'link');
      element.id = handle + (kind === 'scripts' ? '-js' : '-css');
      element.onload = () => { asset.after.forEach(inline); resolve(); };
      element.onerror = () => { element.remove(); reject(new Error('Cannot load ' + asset.src)); };
      if (kind === 'scripts') { element.src = asset.src; element.async = false; }
      else { element.rel = 'stylesheet'; element.href = asset.src; }
      document.head.appendChild(element);
    }));
    pending.set(key, promise);
    return promise;
  }
  async function boot() {
    const content = document.querySelector('.entry-content, .post-content');
    if (current && current.root === content) return;
    leave();
    if (!content) return;
    const session = { root: content, controller: new AbortController(), cleanups: [] };
    current = session;
    const context = {
      root: content,
      signal: session.controller.signal,
      cleanup(callback) {
        if (session.controller.signal.aborted) callback();
        else session.cleanups.push(callback);
      },
    };
    const required = {
      prism: Array.from(content.querySelectorAll('pre')).some(pre => !pre.closest('.arcaea-mermaid-box, .arcaea-markmap-box') && !pre.matches('.mermaid, .arcaea-markmap-source')),
      mermaid: !!content.querySelector('.mermaid, .arcaea-mermaid-box'),
      markmap: !!content.querySelector('.arcaea-markmap-source'),
      zoom: !!content.querySelector('img'),
      math: !!content.querySelector('.katex, .bac-latex-block, .math, .mathjax') || /\$|\\[([]/.test(content.textContent),
    };
    // Serialize renderers across replacements: an old async render must settle
    // before another page uses a shared Mermaid or MathJax runtime.
    work = work.then(async () => {
      if (context.signal.aborted) return;
      const selected = Object.entries(required).filter(([name, needed]) => needed && manifest.groups[name]);
      const results = await Promise.allSettled(selected.map(async ([name]) => {
        const group = manifest.groups[name];
        await Promise.all(group.styles.map(handle => load('styles', handle)));
        for (const handle of group.scripts) await load('scripts', handle);
      }));
      if (context.signal.aborted || !content.isConnected) return;
      for (let index = 0; index < selected.length; index++) {
        if (results[index].status === 'rejected') {
          console.warn('[Babel Arcaea Code]', results[index].reason);
          continue;
        }
        for (const [name, mount] of [...modules].sort(([a], [b]) => Number(a.includes(':')) - Number(b.includes(':')))) {
          if (name.split(':')[0] !== selected[index][0]) continue;
          if (context.signal.aborted) return;
          try { await mount(context); }
          catch (error) { console.warn('[Babel Arcaea Code]', error); }
        }
      }
      if (!context.signal.aborted) document.dispatchEvent(new CustomEvent('bac:content-ready', { detail: { root: content } }));
    }).catch(error => console.warn('[Babel Arcaea Code]', error));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('pjax:complete', boot);
  document.addEventListener('pjax:end', boot);
})();
