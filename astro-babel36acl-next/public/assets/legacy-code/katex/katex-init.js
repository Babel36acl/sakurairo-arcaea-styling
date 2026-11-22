/**
 * Babel Arcaea Code — KaTeX JS init
 *
 * Renders KaTeX math inline ($...$) and display ($$...$$) blocks.
 * Uses KaTeX auto-render for automatic DOM scanning.
 *
 * @package Babel_Arcaea_Code
 */
(function () {
    'use strict';

    const LOG = '[Babel Arcaea Code: KaTeX]';
    const config = window.BAC_Config || {};

    function asBool(value, fallback) {
        if (typeof value === 'boolean') return value;
        if (value === 1 || value === '1') return true;
        if (value === 0 || value === '0') return false;
        return fallback;
    }

    function renderKatexBlocks(scope) {
        if (typeof katex === 'undefined') {
            return;
        }

        scope.querySelectorAll('.bac-latex-block[data-bac-latex="katex"] .bac-latex-source:not([data-bac-katex-rendered="1"])').forEach(function (node) {
            const host = node.closest('.bac-latex-block');
            const source = node.textContent.trim();
            const displayMode = host && host.dataset.display === '1';

            if (!source || !host) return;

            try {
                katex.render(source, host, {
                    displayMode: displayMode,
                    throwOnError: false,
                    strict: false,
                    trust: false,
                });
                host.dataset.bacKatexRendered = '1';
                node.dataset.bacKatexRendered = '1';
            } catch (e) {
                console.warn(LOG, 'block render failed:', e);
            }
        });
    }

    /* ── KaTeX auto-render ── */
    function renderKatex(root) {
        if (!asBool(config.katexEnabled, false)) return;

        const scope = root && root.querySelectorAll ? root : document;

        if (typeof renderMathInElement === 'undefined') {
            console.warn(LOG, 'KaTeX auto-render not loaded.');
            return;
        }

        renderKatexBlocks(scope.body || scope);

        try {
            renderMathInElement(scope.body || scope, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true },
                ],
                throwOnError: false,
                errorColor: '#cc0000',
                strict: false,
                trust: false,
                ignoredClasses: ['no-mathjax', 'bac-latex-source'],
            });
            console.log(LOG, 'rendered');
        } catch (e) {
            console.warn(LOG, 'render failed:', e);
        }
    }

    window.BAC_Lifecycle.register('math', ({ root }) => renderKatex(root));
})();
