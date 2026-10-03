(() => {
  "use strict";

  const gallerySeeds = [44, 17, 23, 93, 40, 27, 58, 66, 35, 71, 12, 84];
  const galleryAssets = {
    12: "/assets/gallery/12.jpg",
    17: "/assets/gallery/17.jpg",
    23: "/assets/gallery/23.jpg",
    27: "/assets/gallery/27.jpg",
    35: "/assets/gallery/35.jpg",
    40: "/assets/gallery/40.png",
    44: "/assets/gallery/44.jpg",
    58: "/assets/gallery/58.jpg",
    66: "/assets/gallery/66.jpg",
    71: "/assets/gallery/71.jpg",
    84: "/assets/gallery/84.jpg",
    93: "/assets/gallery/93.jpg"
  };
  const galleryUrl = (seed) => galleryAssets[seed] || galleryAssets[17];
  const storage = (() => {
    try { return window.sessionStorage; } catch { return null; }
  })();
  let searchIndexPromise;
  let backgroundIndex = Number(storage?.getItem("sakurairo-background-index") || 0);

  const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const schedule = (callback) => (window.requestAnimationFrame ? window.requestAnimationFrame(callback) : window.setTimeout(callback, 0));

  function setHidden(element, hidden) {
    if (!element) return;
    element.hidden = hidden;
    element.setAttribute("aria-hidden", String(hidden));
  }

  function updateChrome() {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = document.getElementById("bar");
    const goTop = document.getElementById("moblieGoTop");
    const skinButton = document.getElementById("changskin");
    const footer = document.getElementById("colophon");
    const header = document.querySelector(".site-header");
    const isMobile = window.matchMedia("(max-width: 860px)").matches;

    progress?.style.setProperty("width", `${Math.min(100, (y / max) * 100)}%`);
    goTop?.classList.toggle("is-visible", y > 20);
    skinButton?.classList.toggle("is-visible", y > 20);
    footer?.classList.toggle("show", y + window.innerHeight >= document.documentElement.scrollHeight - 100);
    header?.classList.toggle("bg", y > 20 || isMobile);
  }

  function bindChrome() {
    if (window.__sakurairoChromeBound) {
      updateChrome();
      return;
    }
    window.__sakurairoChromeBound = true;
    window.addEventListener("scroll", updateChrome, { passive: true });
    window.addEventListener("resize", updateChrome, { passive: true });
    document.getElementById("moblieGoTop")?.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
    updateChrome();
  }

  function closeMobileNav() {
    const button = document.querySelector(".mo-nav-button");
    const nav = document.querySelector(".mobile-nav");
    if (!nav) return;
    nav.classList.remove("open");
    button?.classList.remove("open");
    button?.setAttribute("aria-expanded", "false");
    nav.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mobile-menu-open");
  }

  function bindMobileNav() {
    const button = document.querySelector(".mo-nav-button");
    const nav = document.querySelector(".mobile-nav");
    if (!button || !nav || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = !nav.classList.contains("open");
      if (open) {
        nav.classList.add("open");
        button.classList.add("open");
        button.setAttribute("aria-expanded", "true");
        nav.setAttribute("aria-hidden", "false");
        document.body.classList.add("mobile-menu-open");
      } else {
        closeMobileNav();
      }
    });
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeMobileNav();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".site-header")) closeMobileNav();
    });
  }

  function closeSearch() {
    const modal = document.querySelector("[data-search-modal]");
    setHidden(modal, true);
    document.body.classList.remove("search-open");
  }

  async function getSearchIndex() {
    if (!searchIndexPromise) {
      searchIndexPromise = fetch("/search-index.json", { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : []))
        .catch(() => []);
    }
    return searchIndexPromise;
  }

  function renderSearchResults(results, container, query) {
    if (!container) return;
    container.replaceChildren();
    if (!query) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "输入关键词开始搜索";
      container.appendChild(empty);
      return;
    }
    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = `没有找到“${query}”`;
      container.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    results.slice(0, 12).forEach((entry) => {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = entry.url;
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const excerpt = document.createElement("span");
      excerpt.textContent = entry.excerpt || entry.content;
      link.append(title, excerpt);
      fragment.appendChild(link);
    });
    container.appendChild(fragment);
  }

  function bindSearch() {
    const modal = document.querySelector("[data-search-modal]");
    const input = document.getElementById("search-input");
    const resultContainer = document.querySelector("[data-search-results]");
    if (!modal || !input || modal.dataset.bound === "true") return;
    modal.dataset.bound = "true";
    const openSearch = async () => {
      setHidden(modal, false);
      document.body.classList.add("search-open");
      input.focus();
      await getSearchIndex();
    };
    document.querySelectorAll(".js-toggle-search").forEach((button) => button.addEventListener("click", openSearch));
    document.querySelectorAll(".search_close").forEach((button) => button.addEventListener("click", closeSearch));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeSearch();
    });
    input.addEventListener("input", async () => {
      const query = input.value.trim().toLowerCase();
      const index = await getSearchIndex();
      const results = query
        ? index.filter((entry) => `${entry.title} ${entry.excerpt} ${entry.content}`.toLowerCase().includes(query))
        : [];
      renderSearchResults(results, resultContainer, input.value.trim());
    });
  }

  function bindBackgroundSwitcher() {
    const button = document.getElementById("bg-next");
    const hero = document.getElementById("centerbg");
    const blur = document.querySelector(".background_blur");
    if (!button || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    const apply = (index, animate = true) => {
      const url = galleryUrl(gallerySeeds[index % gallerySeeds.length]);
      if (animate && !prefersReducedMotion()) {
        hero?.classList.add("background-changing");
        blur?.classList.add("background-changing");
        window.setTimeout(() => {
          hero?.classList.remove("background-changing");
          blur?.classList.remove("background-changing");
        }, 520);
      }
      document.body.style.setProperty("--active-background", `url("${url}")`);
      if (hero) hero.style.backgroundImage = `linear-gradient(rgba(0,0,0,.38), rgba(0,0,0,.46)), url("${url}")`;
      if (blur) blur.style.backgroundImage = `url("${url}")`;
      storage?.setItem("sakurairo-background-index", String(index));
    };
    apply(backgroundIndex, false);
    button.addEventListener("click", () => {
      backgroundIndex = (backgroundIndex + 1) % gallerySeeds.length;
      apply(backgroundIndex);
    });
  }

  function bindSkinMenu() {
    const button = document.getElementById("changskin");
    const menu = document.querySelector(".skin-menu");
    if (!button || !menu || menu.dataset.bound === "true") return;
    menu.dataset.bound = "true";
    const setBackground = (index) => {
      const url = galleryUrl(gallerySeeds[index % gallerySeeds.length]);
      const background = `linear-gradient(rgba(8, 9, 13, .72), rgba(8, 9, 13, .78)), url("${url}") center center / cover fixed`;
      document.body.style.setProperty("background", background, "important");
      document.body.style.setProperty("--active-background", `url("${url}")`);
      const hero = document.getElementById("centerbg");
      const blur = document.querySelector(".background_blur");
      hero?.style.setProperty("background-image", `linear-gradient(rgba(0,0,0,.38), rgba(0,0,0,.46)), url("${url}")`);
      blur?.style.setProperty("background-image", `url("${url}")`);
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.classList.toggle("show");
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".skin-menu, #changskin")) menu.classList.remove("show");
    });
    document.getElementById("white-bg")?.addEventListener("click", () => document.body.classList.remove("dark"));
    document.getElementById("dark-bg")?.addEventListener("click", () => document.body.classList.add("dark"));
    ["diy1-bg", "diy2-bg", "diy3-bg", "diy4-bg"].forEach((id, index) => {
      document.getElementById(id)?.addEventListener("click", () => setBackground(index));
    });
    menu.querySelectorAll("[data-name]").forEach((control) => control.addEventListener("click", () => {
      const family = control.dataset.name;
      document.body.classList.toggle("serif", family === "serif");
      document.body.classList.toggle("sans-serif", family === "sans-serif");
      menu.querySelectorAll("[data-name]").forEach((item) => item.classList.toggle("selected", item === control));
    }));
  }

  function bindHeroParallax() {
    const hero = document.querySelector(".headertop");
    if (!hero || hero.dataset.parallaxBound === "true" || prefersReducedMotion()) return;
    hero.dataset.parallaxBound = "true";
    let frame = 0;
    hero.addEventListener("pointermove", (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const x = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      const y = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      cancelAnimationFrame(frame);
      frame = schedule(() => hero.style.setProperty("--hero-x", x.toFixed(3)));
      hero.style.setProperty("--hero-y", y.toFixed(3));
    });
    hero.addEventListener("pointerleave", () => {
      hero.style.setProperty("--hero-x", "0");
      hero.style.setProperty("--hero-y", "0");
    });
  }

  function bindHeroText() {
    const element = document.querySelector(".focusinfo .element");
    if (!element || element.dataset.textBound === "true" || prefersReducedMotion()) return;
    element.dataset.textBound = "true";
    const phrases = [
      "awaiting resonance...",
      "the world is gray, but sound tells the truth.",
      "风の音を探しています...",
      "let the noise become color."
    ];
    let phraseIndex = 0;
    let characterIndex = 0;
    let deleting = false;
    const tick = () => {
      if (!document.documentElement.contains(element)) return;
      const phrase = phrases[phraseIndex];
      characterIndex += deleting ? -1 : 1;
      element.textContent = phrase.slice(0, characterIndex);
      let delay = deleting ? 30 : 72;
      if (!deleting && characterIndex >= phrase.length) {
        delay = 1800;
        deleting = true;
      } else if (deleting && characterIndex <= 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        delay = 380;
      }
      window.__sakurairoQuoteTimer = window.setTimeout(tick, delay);
    };
    window.clearTimeout(window.__sakurairoQuoteTimer);
    window.__sakurairoQuoteTimer = window.setTimeout(tick, 900);
  }

  function bindHeroDown() {
    const button = document.querySelector(".headertop-down");
    const target = document.getElementById("page");
    if (!button || !target || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }));
  }

  function bindReveal() {
    const targets = document.querySelectorAll(".post-list-thumb, .post-card, .page-link, .pattern-center, .article-shell, .content-frame");
    if (!targets.length) return;
    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      targets.forEach((target) => target.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries, instance) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        instance.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    targets.forEach((target) => observer.observe(target));
  }

  function bindToc() {
    const source = document.querySelector(".toc");
    const button = document.querySelector(".mo-toc-button");
    const panel = document.querySelector(".mo_toc_panel");
    const body = panel?.querySelector(".mo_toc_panel__body");
    if (!source || !button || !panel || !body) return;
    button.hidden = false;
    if (button.dataset.bound !== "true") {
      button.dataset.bound = "true";
      body.replaceChildren(source.cloneNode(true));
      const close = () => {
        panel.classList.remove("open");
        setHidden(panel, true);
        button.setAttribute("aria-expanded", "false");
      };
      button.addEventListener("click", () => {
        const open = !panel.classList.contains("open");
        panel.classList.toggle("open", open);
        setHidden(panel, !open);
        button.setAttribute("aria-expanded", String(open));
      });
      panel.querySelector(".mo_toc_close")?.addEventListener("click", close);
      body.addEventListener("click", (event) => {
        if (event.target.closest("a")) close();
      });
    }
  }

  function bindAnchors() {
    if (document.documentElement.dataset.anchorBound === "true") return;
    document.documentElement.dataset.anchorBound = "true";
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || link.getAttribute("href") === "#") return;
      const target = document.getElementById(link.getAttribute("href").slice(1));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      history.pushState(null, "", link.href);
    });
  }

  function closeOverlays() {
    closeMobileNav();
    closeSearch();
    const panel = document.querySelector(".mo_toc_panel");
    setHidden(panel, true);
  }

  function initPage() {
    const preload = document.getElementById("preload");
    if (preload) {
      schedule(() => preload.classList.add("is-loaded"));
      window.setTimeout(() => preload.remove(), 700);
    }
    bindChrome();
    bindMobileNav();
    bindSearch();
    bindBackgroundSwitcher();
    bindSkinMenu();
    bindHeroParallax();
    bindHeroText();
    bindHeroDown();
    bindReveal();
    bindToc();
    bindAnchors();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOverlays();
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      document.querySelector(".js-toggle-search")?.click();
    }
  });
  document.addEventListener("astro:before-swap", () => {
    closeOverlays();
    window.clearTimeout(window.__sakurairoQuoteTimer);
  });
  document.addEventListener("astro:page-load", initPage);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initPage, { once: true });
  else initPage();
})();
