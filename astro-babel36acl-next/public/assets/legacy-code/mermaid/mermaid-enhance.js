(function () {
  'use strict';

  var overlay = null;
  var stage = null;
  var viewport = null;
  var hint = null;
  var state = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    startX: 0,
    startY: 0
  };
  var SOURCE_COLLAPSE_AFTER_LINES = 24;
  var SOURCE_VISIBLE_LINES = 18;

  function ensureXmlns(svg) {
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!svg.getAttribute('xmlns:xlink')) svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }

  function getViewBoxSize(svg) {
    var viewBox = svg.viewBox && svg.viewBox.baseVal;
    if (viewBox && viewBox.width && viewBox.height) {
      return { width: viewBox.width, height: viewBox.height };
    }

    var bbox;
    try {
      bbox = svg.getBBox();
    } catch (_) {
      bbox = null;
    }

    if (bbox && bbox.width && bbox.height) {
      return { width: bbox.width, height: bbox.height };
    }

    return {
      width: svg.clientWidth || 1200,
      height: svg.clientHeight || 800
    };
  }

  function serializeSvg(svg) {
    var clone = svg.cloneNode(true);
    ensureXmlns(clone);
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    return new XMLSerializer().serializeToString(clone);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function exportSvg(svg) {
    downloadBlob(new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }), 'mermaid-diagram.svg');
  }

  function exportPng(svg) {
    var markup = serializeSvg(svg);
    var blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    var size = getViewBoxSize(svg);

    img.onload = function () {
      var scale = 2;
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(size.width * scale));
      canvas.height = Math.max(1, Math.round(size.height * scale));
      var ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.drawImage(img, 0, 0, size.width, size.height);
      canvas.toBlob(function (pngBlob) {
        if (pngBlob) downloadBlob(pngBlob, 'mermaid-diagram.png');
        URL.revokeObjectURL(url);
      }, 'image/png');
    };

    img.onerror = function () {
      URL.revokeObjectURL(url);
      console.warn('[Babel Arcaea Code] Mermaid PNG export failed.');
    };

    img.src = url;
  }

  function applyTransform() {
    if (!viewport) return;
    viewport.style.transform =
      'translate(calc(-50% + ' + state.offsetX + 'px), calc(-50% + ' + state.offsetY + 'px)) scale(' + state.scale + ')';
    if (hint) {
      hint.textContent = '滚轮缩放，拖拽平移，ESC 关闭 · ' + Math.round(state.scale * 100) + '%';
    }
  }

  function getFitScale(svg) {
    var size = getViewBoxSize(svg);
    var maxWidth = Math.max(320, window.innerWidth - 64);
    var maxHeight = Math.max(240, window.innerHeight - 96);
    if (!size.width || !size.height) return 1;
    return Math.min(1, maxWidth / size.width, maxHeight / size.height);
  }

  function resetTransform(initialScale) {
    state.scale = initialScale || 1;
    state.offsetX = 0;
    state.offsetY = 0;
    applyTransform();
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.classList.remove('active');
    viewport.innerHTML = '';
    resetTransform();
  }

  function ensureOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.className = 'arcaea-mermaid-overlay';

    stage = document.createElement('div');
    stage.className = 'arcaea-mermaid-overlay-stage';
    overlay.appendChild(stage);

    viewport = document.createElement('div');
    viewport.className = 'arcaea-mermaid-overlay-viewport';
    stage.appendChild(viewport);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'arcaea-mermaid-overlay-close';
    close.setAttribute('aria-label', '关闭 Mermaid 全屏');
    close.textContent = '×';
    close.addEventListener('click', closeOverlay);
    overlay.appendChild(close);

    hint = document.createElement('div');
    hint.className = 'arcaea-mermaid-overlay-hint';
    overlay.appendChild(hint);

    overlay.addEventListener('click', function (event) {
      if (
        event.target === overlay ||
        event.target.classList.contains('arcaea-mermaid-overlay-stage')
      ) {
        closeOverlay();
      }
    });

    stage.addEventListener('wheel', function (event) {
      event.preventDefault();
      var delta = event.deltaY < 0 ? 0.1 : -0.1;
      state.scale = Math.min(4, Math.max(0.5, state.scale + delta));
      applyTransform();
    }, { passive: false });

    stage.addEventListener('pointerdown', function (event) {
      state.dragging = true;
      state.startX = event.clientX - state.offsetX;
      state.startY = event.clientY - state.offsetY;
      stage.classList.add('is-dragging');
    });

    stage.addEventListener('pointermove', function (event) {
      if (!state.dragging) return;
      state.offsetX = event.clientX - state.startX;
      state.offsetY = event.clientY - state.startY;
      applyTransform();
    });

    function endDrag() {
      state.dragging = false;
      if (stage) stage.classList.remove('is-dragging');
    }

    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointerleave', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && overlay.classList.contains('active')) {
        closeOverlay();
      }
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function openOverlay(svg) {
    ensureOverlay();
    viewport.innerHTML = '';

    var clone = svg.cloneNode(true);
    var size = getViewBoxSize(svg);
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.style.width = size.width ? size.width + 'px' : 'auto';
    clone.style.minWidth = '0';
    clone.style.maxWidth = 'none';
    clone.style.height = 'auto';
    viewport.appendChild(clone);

    overlay.classList.add('active');
    resetTransform(getFitScale(svg));
  }

  function createButton(label, title, onClick) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'arcaea-mermaid-tool';
    button.textContent = label;
    button.setAttribute('aria-label', title);
    button.setAttribute('title', title);
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function countLines(text) {
    if (!text) return 0;
    return String(text).replace(/\n$/, '').split('\n').length;
  }

  function computeCollapseHeight(pre) {
    var styles = window.getComputedStyle(pre);
    var lineHeight = parseFloat(styles.lineHeight) || 20.8;
    var paddingTop = parseFloat(styles.paddingTop) || 0;
    var paddingBottom = parseFloat(styles.paddingBottom) || 0;
    return Math.round(lineHeight * SOURCE_VISIBLE_LINES + paddingTop + paddingBottom);
  }

  function ensureSourcePanel(box) {
    if (!box) return;
    if (box.querySelector('.bac-code-shell.arcaea-mermaid-source-shell')) return;

    var pre = box.querySelector('pre.mermaid');
    if (!pre || !pre.dataset.bacMermaidSource) return;

    var source = pre.dataset.bacMermaidSource.trim();
    if (!source) return;

    var lineCount = countLines(source);
    if (lineCount <= SOURCE_COLLAPSE_AFTER_LINES) return;

    var shell = document.createElement('div');
    shell.className = 'bac-code-shell arcaea-mermaid-source-shell bac-code-collapsible bac-code-collapsed';
    shell.dataset.bacCodeLines = String(lineCount);

    var titlebar = document.createElement('div');
    titlebar.className = 'bac-code-titlebar';
    titlebar.innerHTML =
      '<span class="bac-code-titlebar-dots"><span></span><span></span><span></span></span>' +
      '<span class="bac-code-titlebar-name">Mermaid Source</span>';

    var sourcePre = document.createElement('pre');
    sourcePre.className = 'arcaea-mermaid-source language-mermaid';
    var sourceCode = document.createElement('code');
    sourceCode.className = 'language-mermaid';
    sourceCode.textContent = source;
    sourcePre.appendChild(sourceCode);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'bac-code-fold-toggle';
    button.textContent = '展开完整代码';
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var collapsed = shell.classList.toggle('bac-code-collapsed');
      button.textContent = collapsed ? '展开完整代码' : '收起代码';
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });

    shell.appendChild(titlebar);
    shell.appendChild(sourcePre);
    shell.appendChild(button);
    box.appendChild(shell);
    shell.style.setProperty('--bac-code-collapse-height', String(computeCollapseHeight(sourcePre)) + 'px');
  }

  function ensureToolbar(box, svg) {
    if (box.querySelector('.arcaea-mermaid-toolbar')) return;

    var toolbar = document.createElement('div');
    toolbar.className = 'arcaea-mermaid-toolbar';
    toolbar.appendChild(createButton('⛶', '查看 Mermaid 大图', function () {
      openOverlay(svg);
    }));
    toolbar.appendChild(createButton('SVG', '导出 SVG', function () {
      exportSvg(svg);
    }));
    toolbar.appendChild(createButton('PNG', '导出 PNG', function () {
      exportPng(svg);
    }));
    box.appendChild(toolbar);
  }

  function enhance(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.arcaea-mermaid-box').forEach(function (box) {
      var svg = box.querySelector('svg');
      if (!svg || box.dataset.bacMermaidEnhanced === '1') return;
      box.dataset.bacMermaidEnhanced = '1';
      ensureToolbar(box, svg);
      ensureSourcePanel(box);
    });
  }

  window.BAC_Lifecycle.register('mermaid:enhance', ({ root, signal, cleanup }) => {
    enhance(root);
    root.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      const diagram = event.target.closest('pre.mermaid');
      const svg = diagram && diagram.querySelector('svg');
      if (svg) openOverlay(svg);
    }, { signal });
    cleanup(closeOverlay);
  });
})();
