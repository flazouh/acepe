/**
 * Blog post metadata interface
 *
 * This interface defines the structure for blog post metadata used for
 * SEO, post listing, and post rendering.
 */
export interface BlogPostMetadata {
	/** Post title (used in <title> tag and heading) */
	readonly title: string;

	/** Post description (used in meta description and post listing) */
	readonly description: string;

	/** Publication date in ISO 8601 format (YYYY-MM-DD) */
	readonly date: string;

	/** URL slug (e.g., 'attention-queue' for /blog/attention-queue) */
	readonly slug: string;

	/** Optional OpenGraph image URL for social sharing */
	readonly ogImage?: string;

	/** Optional author name */
	readonly author?: string;

	/** Optional estimated reading time in minutes */
	readonly readingTimeMinutes?: number;

	/** Optional category (e.g., "Features", "Announcements") */
	readonly category?: string;

	/** Optional character count of the article (for diff-style display) */
	readonly characterCount?: number;
}
