import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { createReportInput, listReportsParams } from '@acepe/api';
import { getService, optionalAuth, requireAuth, toReportOutput } from './_helpers';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const service = getService();
	const user = await optionalAuth(cookies);

	const parsed = listReportsParams.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) throw error(400, 'Invalid parameters');

	const { page, limit, sort, category, status, authorId, search } = parsed.data;

	const result = await service.listReports({ category, status, authorId, search }, sort, page, limit);

	return result.match(
		async ({ items, totalCount }) => {
			const enriched = await service.enrichReportsWithUserData(items, user?.id ?? null);
			return enriched.match(
				(enrichedItems) =>
					json({
						items: enrichedItems.map(toReportOutput),
						page,
						limit,
						totalCount,
						totalPages: Math.ceil(totalCount / limit),
					}),
				() => {
					throw error(500, 'Failed to enrich reports');
				}
			);
		},
		() => {
			throw error(500, 'Failed to list reports');
		}
	);
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const body = await request.json();
	const parsed = createReportInput.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid input');

	const result = await service.createReport(user, parsed.data);

	return result.match(
		async (report) => {
			const enriched = await service.enrichReportWithUserData(report, user.id);
			return enriched.match(
				(r) => json(toReportOutput(r), { status: 201 }),
				() => {
					throw error(500, 'Failed to enrich report');
				}
			);
		},
		() => {
			throw error(500, 'Failed to create report');
		}
	);
};
