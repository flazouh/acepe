import { getAllBlogPosts } from "$lib/blog/posts.js";
import { getAllComparisonSlugs, getComparison } from "$lib/compare/data.js";
import { baseLocale, locales } from "$lib/paraglide/runtime";
import type { RequestHandler } from "./$types";

const baseUrl = "https://acepe.dev";

interface Route {
	path: string;
	priority: string;
	changefreq: string;
	lastmod?: string;
}

const today = new Date().toISOString().split("T")[0];

const publicRoutes: Route[] = [
	{ path: "/", priority: "1.0", changefreq: "weekly" },
	{ path: "/blog", priority: "0.7", changefreq: "weekly" },
	{ path: "/changelog", priority: "0.7", changefreq: "weekly" },
	{ path: "/download", priority: "0.8", changefreq: "weekly" },
	{ path: "/pricing", priority: "0.8", changefreq: "weekly" },
	{ path: "/compare", priority: "0.8", changefreq: "weekly" },
	{ path: "/roadmap", priority: "0.7", changefreq: "daily" },
]
	.concat(
		getAllBlogPosts().map((post) => ({
			path: `/blog/${post.slug}`,
			priority: "0.7",
			changefreq: "monthly",
			lastmod: post.date,
		}))
	)
	.concat(
		getAllComparisonSlugs().map((slug) => {
			const comparison = getComparison(slug);

			return {
				path: `/compare/${slug}`,
				priority: "0.8",
				changefreq: "weekly",
				lastmod: comparison?.lastVerifiedOn ?? today,
			};
		})
	);

interface SitemapEntry {
	loc: string;
	lastmod: string;
	priority: string;
	changefreq: string;
}

export const GET: RequestHandler = async () => {
	const entries: SitemapEntry[] = publicRoutes.flatMap((route) => {
		return locales.map((locale) => {
			const localizedPath = locale === baseLocale ? route.path : `/${locale}${route.path}`;

			return {
				loc: `${baseUrl}${localizedPath}`,
				lastmod: route.lastmod ?? today,
				priority: route.priority,
				changefreq: route.changefreq,
			};
		});
	});

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
	.map(
		(entry) => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`
	)
	.join("\n")}
</urlset>`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/xml",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
