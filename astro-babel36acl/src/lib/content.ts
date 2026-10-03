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
  return [...byRoute.values()].sort((a, b) => b.date.localeCompare(a.date) || a.route.localeCompare(b.route));
}

export async function getPosts() {
  return (await getEntries()).filter((entry) => entry.type === 'post');
}
