import { defineCollection } from "astro:content";
import type { CollectionConfig } from "astro/content/config";
import { glob } from "astro/loaders";
import { type ZodType, z } from "astro/zod";

type PostData = {
	title: string;
	published: Date;
	updated?: Date;
	draft: boolean;
	description: string;
	permalink: string;
	legacyId?: number;
	image: string;
	tags: string[];
	category: string | null;
	categories: string[];
	primaryCategory: string | null;
	contentType: "post";
	canonicalPath: string;
	legacyUrls: string[];
	commentKey: string;
	sourceSlug: string;
	lang: string;
	pinned: boolean;
	author: string;
	sourceLink: string;
	licenseName: string;
	licenseUrl: string;
	comment: boolean;
	password: string;
	passwordHint: string;
	series: string;
	seriesOrder?: number;
	prevTitle: string;
	prevSlug: string;
	nextTitle: string;
	nextSlug: string;
};

type LegacyPageData = {
	title: string;
	published: Date;
	updated?: Date;
	draft: boolean;
	description: string;
	permalink: string;
	slug: string;
	legacyId: number;
	canonicalPath: string;
	legacyUrls: string[];
	sourceSlug: string;
};

type DynamicData = {
	published: Date;
	pinned: boolean;
	location: string;
};

type ProjectLink = {
	label: string;
	icon: string;
	value: string;
};

type ProjectData = {
	title: string;
	published: Date;
	draft: boolean;
	order?: number;
	description: string;
	image: string;
	tags: string[];
	link: ProjectLink[];
	status: string;
	lang: string;
};

type ContentCollection<T> = CollectionConfig<
	ZodType<T>,
	ReturnType<typeof glob>
>;

const postsCollection: ContentCollection<PostData> = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		permalink: z.string().optional().default(""),
		legacyId: z.number().int().positive().optional(),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().nullable().default(""),
		categories: z.array(z.string()).optional().default([]),
		primaryCategory: z.string().optional().nullable().default(""),
		contentType: z.literal("post").default("post"),
		canonicalPath: z.string().regex(/^\/(?:[^\s/]+\/)*$/u),
		legacyUrls: z.array(z.string()).optional().default([]),
		commentKey: z.string().min(1),
		sourceSlug: z.string().optional().default(""),
		lang: z.string().optional().default(""),
		pinned: z.boolean().optional().default(false),
		author: z.string().optional().default(""),
		sourceLink: z.string().optional().default(""),
		licenseName: z.string().optional().default(""),
		licenseUrl: z.string().optional().default(""),
		comment: z.boolean().optional().default(true),
		password: z.string().optional().default(""),
		passwordHint: z.string().optional().default(""),
		series: z.string().optional().default(""),
		seriesOrder: z.number().optional(),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});

const legacyPagesCollection: ContentCollection<LegacyPageData> = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		permalink: z.string(),
		slug: z.string().min(1),
		legacyId: z.number().int().positive(),
		canonicalPath: z.string().regex(/^\/(?:[^\s/]+\/)*$/u),
		legacyUrls: z.array(z.string()).optional().default([]),
		sourceSlug: z.string().optional().default(""),
	}),
});

const specCollection: ContentCollection<Record<string, never>> =
	defineCollection({
		loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/spec" }),
		schema: z.object({}),
	});

const dynamicCollection: ContentCollection<DynamicData> = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/dynamic" }),
	schema: z.object({
		published: z.date(),
		pinned: z.boolean().optional().default(false),
		location: z.string().optional().default(""),
	}),
});

const projectsCollection: ContentCollection<ProjectData> = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
	schema: z.object({
		title: z.string(),
		published: z.date(),
		draft: z.boolean().optional().default(false),
		order: z.number().optional(),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		link: z
			.array(
				z.object({
					label: z.string(),
					icon: z.string().optional().default(""),
					value: z.string(),
				}),
			)
			.optional()
			.default([]),
		status: z.string().optional().default(""),
		lang: z.string().optional().default(""),
	}),
});

export const collections: {
	dynamic: typeof dynamicCollection;
	posts: typeof postsCollection;
	pages: typeof legacyPagesCollection;
	spec: typeof specCollection;
	projects: typeof projectsCollection;
} = {
	dynamic: dynamicCollection,
	posts: postsCollection,
	pages: legacyPagesCollection,
	spec: specCollection,
	projects: projectsCollection,
};
