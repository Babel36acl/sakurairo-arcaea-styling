import tocbot from "./vendor/legacy-tocbot.js";
export function initLegacyArticle(): void {
	const content = document.querySelector<HTMLElement>(".entry-content");
	const toc = document.querySelector<HTMLElement>(".toc");
	if (!content || !toc || content.dataset.articleReady) return;
	content.dataset.articleReady = "true";
	const controller = new AbortController();
	tocbot.init({tocSelector:"#main-container .toc",contentSelector:".entry-content",headingSelector:"h1,h2,h3,h4,h5",headingsOffset:1-window.innerHeight/2,onClick:null});
	const container = toc.parentElement;
	const measureHeader = () => {
		const capsule = document.querySelector<HTMLElement>(".nav-search-wrapper");
		const nav = capsule?.querySelector("nav");
		const title = capsule?.querySelector(".nav-article-title");
		if (!capsule || !nav || !title || window.innerWidth <= 860) return;
		const swapped = capsule.hasAttribute("data-scrollswap");
		delete capsule.dataset.scrollswap;
		const width = capsule.getBoundingClientRect().width - nav.getBoundingClientRect().width + title.getBoundingClientRect().width;
		capsule.style.setProperty("--article-title-width", `${width}px`);
		if (swapped) capsule.dataset.scrollswap = "true";
	};
	let frame = 0;
	const sync = () => {
		frame = 0;
        const capsule = document.querySelector<HTMLElement>(".nav-search-wrapper");
        const title = document.querySelector<HTMLElement>(".entry-title");
        if (capsule && title) {
            if (title.getBoundingClientRect().top < 0) capsule.dataset.scrollswap = "true";
            else delete capsule.dataset.scrollswap;
        }
        for (const control of document.querySelectorAll<HTMLElement>("#moblieGoTop,#changskin")) control.style.transform = scrollY > 20 ? "scale(1)" : "scale(0)";
	};
	const resize = () => {
		if (container) container.style.height = `${Math.min(document.querySelector(".site-content")!.getBoundingClientRect().height, document.documentElement.offsetHeight - container.offsetTop)}px`;
		sync();
	};
	window.addEventListener("scroll", () => { if (!frame) frame = requestAnimationFrame(sync); }, { passive:true, signal:controller.signal });
	window.addEventListener("resize", resize, { signal:controller.signal });
	document.addEventListener("bac:content-ready", resize, { signal:controller.signal });
	const followHeading = (event: MouseEvent) => {
		const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
		const target = link && document.getElementById(link.hash.slice(1));
		if (!target) return;
		event.preventDefault(); event.stopPropagation(); history.replaceState(null,"",link!.hash);
		window.scrollTo({ top: target.getBoundingClientRect().top + scrollY - 80, behavior:"smooth" });
	};
	toc.addEventListener("click", followHeading, {signal:controller.signal});
    const mobilePanel = document.getElementById("legacy-mobile-toc");
    const mobileButton = document.querySelector<HTMLButtonElement>(".mo-toc-button");
    const closeMobile = () => {
        mobilePanel?.classList.remove("open"); mobilePanel?.setAttribute("inert", "");
        mobileButton?.classList.remove("open"); mobileButton?.setAttribute("aria-expanded", "false");
    };
    mobileButton?.addEventListener("click", () => {
        if (!mobilePanel || mobilePanel.classList.contains("open")) { closeMobile(); return; }
        document.getElementById("mobile-navigation")?.classList.remove("open");
        const copy = toc.cloneNode(true) as HTMLElement; copy.className = "mo-toc-content";
        for (const list of copy.querySelectorAll("ol")) list.classList.remove("is-collapsible", "is-collapsed");
        mobilePanel.querySelector(".mo_toc")?.replaceChildren(copy);
        mobilePanel.classList.add("open"); mobilePanel.removeAttribute("inert");
        mobileButton.classList.add("open"); mobileButton.setAttribute("aria-expanded", "true");
    }, { signal:controller.signal });
    mobilePanel?.addEventListener("click", event => {
        if ((event.target as Element).closest("a")) { followHeading(event); closeMobile(); }
    }, { signal:controller.signal });
    document.addEventListener("keydown", event => { if (event.key === "Escape") closeMobile(); }, { signal:controller.signal });
    document.getElementById("moblieGoTop")?.addEventListener("click", () => window.scrollTo({top:0,behavior:"smooth"}), { signal:controller.signal });
    const skin = document.querySelector<HTMLElement>(".skin-menu");
    const skinButton = document.getElementById("changskin");
    skinButton?.addEventListener("click", () => {
        const open = skin?.classList.toggle("show"); skinButton.setAttribute("aria-expanded", String(!!open));
    }, {signal:controller.signal});
    window.addEventListener("scroll", () => {skin?.classList.remove("show");skinButton?.setAttribute("aria-expanded","false");}, {passive:true,signal:controller.signal});
    skin?.addEventListener("click", event => {
        const target = (event.target as Element).closest<HTMLElement>("li[id],button[data-name]");
        if (!target) return;
        if (target.id === "white-bg" || target.id === "dark-bg") {
            const dark = target.id === "dark-bg";document.body.classList.toggle("dark",dark);document.documentElement.classList.toggle("dark",dark);
        } else if (/^diy[1-4]-bg$/.test(target.id)) {
            document.body.style.backgroundImage = `url("https://s.nmxc.ltd/sakurairo_vision/@3.0/background/bg${target.id[3]}.png")`;
        } else if (target.dataset.name) {
            document.body.classList.toggle("serif", target.dataset.name === "serif");document.body.classList.toggle("sans-serif", target.dataset.name === "sans-serif");
            for (const button of skin.querySelectorAll("button[data-name]")) button.classList.toggle("selected",button === target);
        }
    }, {signal:controller.signal});
    const gallery = ["12.jpg","17.jpg","23.jpg","27.jpg","35.jpg","40.png","44.jpg","58.jpg","66.jpg","71.jpg","84.jpg","93.jpg"];
    const lazy = new IntersectionObserver(entries => { for (const item of entries) if (item.isIntersecting) {
        const el = item.target as HTMLElement;
        el.style.backgroundImage = 'url("/assets/gallery/' + gallery[Math.floor(Math.random()*gallery.length)] + '")';
        el.classList.replace("lazyload", "lazyloaded"); lazy.unobserve(el);
    } });
    for (const el of document.querySelectorAll("[data-article-gallery]")) lazy.observe(el);
    const observer = new ResizeObserver(resize); observer.observe(content);
	window.addEventListener("pagehide", () => { tocbot.destroy(); controller.abort(); lazy.disconnect(); observer.disconnect(); cancelAnimationFrame(frame); }, { once:true });
	void document.fonts.ready.then(() => { measureHeader(); resize(); });
	window.addEventListener("resize", measureHeader, {signal:controller.signal});
	measureHeader();
	resize();
}
