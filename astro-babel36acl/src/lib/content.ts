import { getCollection, type CollectionEntry } from 'astro:content';
import legacyPosts from '../data/posts.json';
import legacyPages from '../data/pages.json';

export interface Entry {
  id: number | string;
  type: string;
  route: string;
  title: string;
  excerpt: string;
  date: string;
  modified: string;
  content: string;
  categories?: { id: number | string; name: string }[];
  tags?: { id: number | string; name: string }[];
  markdown?: CollectionEntry<'articles'>;
}

const SITE_ORIGIN = 'https://babel36acl.xyz';

// Historical WordPress slugs that appeared in page copy but have no static
// equivalent of their own. The values are preserved routes, never invented
// article content.
export const legacyRouteAliases = new Map([
  ['methods-and-tools', '方法与工具'],
  ['2026/05/28/tutorial-cmake', '2026/06/02/stm32-cmake-工程实践-从-cubemx-到分层架构'],
  ['2026/05/28/tutorial-wsl2', '2026/05/29/嵌入式开发环境搭建完全指南：从-wsl2-到完整-stm32-工具'],
  ['2026/05/28/arch-linux-embedded-dev-environment', '2026/05/29/嵌入式开发环境搭建完全指南：从-wsl2-到完整-stm32-工具'],
  ['tutorial-cmake', '2026/06/02/stm32-cmake-工程实践-从-cubemx-到分层架构'],
  ['tutorial-wsl2', '2026/05/29/嵌入式开发环境搭建完全指南：从-wsl2-到完整-stm32-工具'],
  ['arch-linux-embedded-dev-environment', '2026/05/29/嵌入式开发环境搭建完全指南：从-wsl2-到完整-stm32-工具'],
  ['hmi-dual-serial-port-isolation', '2026/05/29/flutter-工业-hmi-仪表盘-ui-架构：3746-行的响应式控制面板设计'],
  ['flutter-hmi-完整架构：从串口抽象到控制器状态管理', '2026/05/29/flutter-工业-hmi-仪表盘-ui-架构：3746-行的响应式控制面板设计'],
  ['from-dgus-to-hmis-protocol-evolution', '2026/05/28/hmis-session-protocol-replaces-dgus'],
  ['mcu端-hmi-session-协议实现', '2026/05/28/hmis-session-protocol-replaces-dgus'],
  ['bsp_dc_motor-直流电机-bsp-驱动-ir2104-h-bridge-nmos-relay-深度解析', 'bsp_dc_motor-直流电机-bsp-驱动-ir2104-h-bridge-nmos-relay-深度解析'],
  ['dc-电机统一功率管理框架-packer_power_limit-设计解析', 'dc-电机统一功率管理框架-packer_power_limit-设计解析'],
]);

function routeKey(value: string) {
  return decodeURIComponent(String(value || '')).replace(/^\/+|\/+$/g, '').toLowerCase();
}

function entrySlug(entry: Entry & { slug?: string }) {
  if (entry.slug) return routeKey(entry.slug);
  return routeKey(entry.route.split('/').pop() || '');
}

/**
 * WordPress emitted two kinds of internal links that are not canonical in a
 * static build: `/?p=123` and `/post-slug/`. Resolve both to the preserved
 * date based route before HTML reaches the page renderer.
 */
export function normalizeInternalLinks(html: string, entries: Entry[]) {
  const byId = new Map(entries.map((entry) => [String(entry.id), entry.route]));
  const byRoute = new Map(entries.map((entry) => [routeKey(entry.route), entry.route]));
  const bySlug = new Map(entries.map((entry) => [entrySlug(entry as Entry & { slug?: string }), entry.route]));
  return String(html || '').replace(/\b(href|src)=(['"])(.*?)\2/gi, (match, attribute, quote, raw) => {
    if (!raw || /^(?:#|mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return match;

    let url;
    try { url = new URL(raw, SITE_ORIGIN); } catch { return match; }
    if (url.origin !== SITE_ORIGIN) return match;

    const queryId = url.searchParams.get('p') || url.searchParams.get('page_id');
    let route = queryId ? byId.get(queryId) : undefined;
    const key = routeKey(url.pathname);
    if (!route) {
      route = byRoute.get(key) || bySlug.get(key) || legacyRouteAliases.get(key) || legacyRouteAliases.get(key.split('/').pop());
    }
    if (!route) return match;

    const suffix = `${url.hash || ''}`;
    const normalized = `/${route.replace(/^\/+|\/+$/g, '')}/${suffix}`;
    return `${attribute}=${quote}${normalized}${quote}`;
  });
}

export function plainText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

export async function getEntries(): Promise<Entry[]> {
  const legacy: Entry[] = [...legacyPosts, ...legacyPages];
  const byRoute = new Map(legacy.map((entry) => [entry.route, entry]));
  const markdown = await getCollection('articles');
  const seen = new Set<string>();
  for (const article of markdown) {
    const data = article.data;
    const route = data.permalink.slice(1, -1);
    if (seen.has(route)) throw new Error(`Markdown permalink 重复: ${data.permalink}`);
    seen.add(route);
    if (/^\d{4}\/\d{2}$/.test(route) || /^(?:assets|_astro|wp-content|page)(?:\/|$)/.test(route)) {
      throw new Error(`Markdown permalink 与系统路由冲突: ${data.permalink}`);
    }
    const existing = byRoute.get(route);
    if (data.legacyId !== undefined) {
      const original = legacy.find((entry) => entry.id === data.legacyId);
      if (!original || original.route !== route || original.type !== 'post') {
        throw new Error(`${article.id}: legacyId 必须指向同一 permalink 的已有文章`);
      }
    } else if (existing) {
      throw new Error(`${article.id}: permalink 已被旧文章使用；改写旧文章须明确填写 legacyId`);
    }
    // 草稿仅在本地开发显示；改写旧文章的草稿不会让线上旧版本消失。
    if (data.draft && import.meta.env.PROD) continue;
    byRoute.set(route, {
      id: data.legacyId ?? `md-${article.slug.replace(/[^\p{L}\p{N}_-]/gu, '-')}`,
      type: 'post', route, title: data.title, excerpt: data.description,
      date: `${data.published}T00:00:00+08:00`,
      modified: data.updated ?? data.published,
      content: article.body,
      categories: data.categories.map((name) => ({ id: name, name })),
      tags: data.tags.map((name) => ({ id: name, name })),
      markdown: article,
    });
  }
  const entries = [...byRoute.values()].sort((a, b) => b.date.localeCompare(a.date) || a.route.localeCompare(b.route));
  return entries.map((entry) => ({ ...entry, content: normalizeInternalLinks(entry.content, entries) }));
}

export async function getPosts() {
  return (await getEntries()).filter((entry) => entry.type === 'post');
}
