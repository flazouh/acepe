import type { RequestHandler } from './$types';
import { baseLocale, locales } from '$lib/paraglide/runtime';

const baseUrl = 'https://acepe.dev';

interface Route {
	path: string;
	priority: string;
	changefreq: string;
}

const publicRoutes: Route[] = [
	{ path: '/', priority: '1.0', changefreq: 'weekly' },
	{ path: '/download', priority: '0.8', changefreq: 'weekly' },
	{ path: '/roadmap', priority: '0.7', changefreq: 'daily' }
];

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
				lastmod: new Date().toISOString().split('T')[0],
				priority: route.priority,
				changefreq: route.changefreq
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
	.join('\n')}
</urlset>`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
