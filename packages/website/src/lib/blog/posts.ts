import type { BlogPostMetadata } from "./types.js";

export const gitViewerBlogPost: BlogPostMetadata = {
	title: "Git Viewer: Beautiful Inline Diffs for Commits and PRs",
	description:
		"Acepe's git viewer lets you browse commits and pull requests with a compact file tree, syntax-highlighted diffs, and inline stats — without leaving your agent session.",
	date: "2026-02-24",
	slug: "git-viewer",
	readingTimeMinutes: 5,
	category: "Features",
	characterCount: 4100,
	relatedLinks: [
		{
			href: "/compare/cursor",
			title: "See Acepe vs Cursor",
			description:
				"Compare agent review visibility and workflow control against a general coding IDE.",
		},
	],
};

export const gitPanelBlogPost: BlogPostMetadata = {
	title: "Git Panel: A Full Git Workflow Without Leaving Acepe",
	description:
		"Stage files, write commits, push and pull, browse history and stash — all from a dedicated panel inside Acepe.",
	date: "2026-02-24",
	slug: "git-panel",
	readingTimeMinutes: 4,
	category: "Features",
	characterCount: 3200,
	relatedLinks: [
		{
			href: "/compare/cursor",
			title: "See Acepe vs Cursor",
			description: "Compare a full in-app git workflow with an editor-centric AI toolchain.",
		},
		{
			href: "/download",
			title: "Download Acepe",
			description: "Try the Git Panel locally in the desktop app.",
		},
	],
};

export const checkpointsBlogPost: BlogPostMetadata = {
	title: "Checkpoints: Time-Travel Debugging for AI Agents",
	description:
		"Learn how Acepe's checkpoint system creates point-in-time snapshots of file changes, letting you revert mistakes and track history with file-level granularity.",
	date: "2026-02-20",
	slug: "checkpoints",
	readingTimeMinutes: 7,
	category: "Features",
	characterCount: 3500,
	relatedLinks: [
		{
			href: "/compare/t3",
			title: "See Acepe vs T3",
			description:
				"Compare checkpoint history and operator controls against a minimal coding-agent GUI.",
		},
		{
			href: "/download",
			title: "Download Acepe",
			description: "Try checkpoints locally and keep your rollbacks inside the app.",
		},
	],
};

export const attentionQueueBlogPost: BlogPostMetadata = {
	title: "Understanding the Attention Queue",
	description:
		"Learn how Acepe's attention queue helps you manage AI agent interactions by prioritizing what needs your attention most.",
	date: "2026-02-20",
	slug: "attention-queue",
	readingTimeMinutes: 8,
	category: "Product",
	characterCount: 4200,
	relatedLinks: [
		{
			href: "/compare/1code",
			title: "See Acepe vs 1Code",
			description:
				"Compare session triage and operator workflow depth against an open-source agent client.",
		},
	],
};

const blogPosts: readonly BlogPostMetadata[] = [
	gitViewerBlogPost,
	gitPanelBlogPost,
	checkpointsBlogPost,
	attentionQueueBlogPost,
];

const postsBySlug: ReadonlyMap<string, BlogPostMetadata> = new Map(
	blogPosts.map((post) => [post.slug, post])
);

export function getAllBlogPosts(): readonly BlogPostMetadata[] {
	return blogPosts;
}

export function getBlogPost(slug: string): BlogPostMetadata | null {
	return postsBySlug.get(slug) ?? null;
}
