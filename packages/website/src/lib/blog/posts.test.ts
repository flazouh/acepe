import { describe, expect, it } from "vitest";

import {
	attentionQueueBlogPost,
	checkpointsBlogPost,
	getAllBlogPosts,
	gitPanelBlogPost,
	gitViewerBlogPost,
	sqlStudioBlogPost,
} from "./posts.js";

describe("blog post registry", () => {
	it("exposes the published blog posts with internal funnel links", () => {
		expect(getAllBlogPosts().map((post) => post.slug)).toEqual([
			"sql-studio",
			"git-viewer",
			"git-panel",
			"checkpoints",
			"attention-queue",
		]);

		expect(attentionQueueBlogPost.relatedLinks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ href: "/compare/1code" }),
				expect.objectContaining({ href: "/pricing" }),
			])
		);

		expect(checkpointsBlogPost.relatedLinks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ href: "/compare/t3" }),
				expect.objectContaining({ href: "/download" }),
			])
		);

		expect(sqlStudioBlogPost.relatedLinks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ href: "/compare/superset" }),
				expect.objectContaining({ href: "/pricing" }),
			])
		);

		expect(gitPanelBlogPost.relatedLinks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ href: "/compare/cursor" }),
				expect.objectContaining({ href: "/download" }),
			])
		);

		expect(gitViewerBlogPost.relatedLinks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ href: "/compare/cursor" }),
				expect.objectContaining({ href: "/pricing" }),
			])
		);
	});
});
