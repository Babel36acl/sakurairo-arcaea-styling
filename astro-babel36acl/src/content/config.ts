import { defineCollection, z } from 'astro:content';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, '日期须为有效的 YYYY-MM-DD 字符串，请加引号');

export const collections = {
  articles: defineCollection({
    type: 'content',
    schema: z.object({
      title: z.string().trim().min(1),
      description: z.string().trim().min(1),
      published: day,
      updated: day.optional(),
      // 与文件名分离，修改标题和日期不会改变已发布的网址。
      permalink: z.string().regex(/^\/(?:[\p{L}\p{N}_-]+\/)+$/u,
        'permalink 应为 /2026/10/03/my-post/，仅包含文字、数字、横线、下划线和路径分隔符'),
      draft: z.boolean().default(true),
      categories: z.array(z.string().trim().min(1)).default([]),
      tags: z.array(z.string().trim().min(1)).default([]),
      legacyId: z.number().int().positive().optional(),
    }).refine((data) => !data.updated || data.updated >= data.published,
      'updated 不能早于 published'),
  }),
};
