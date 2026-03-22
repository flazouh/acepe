import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { updateReportInput } from '@acepe/api';
import { getService, optionalAuth, requireAuth, toReportOutput } from '../_helpers';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const service = getService();
	const user = await optionalAuth(cookies);

	const result = await service.getReport(params.id);

	return result.match(
		async (report) => {
			const enriched = await service.enrichReportWithUserData(report, user?.id ?? null);
			return enriched.match(
				(r) => json(toReportOutput(r)),
				() => {
					throw error(500, 'Failed to enrich report');
				}
			);
		},
		(e) => {
			if (e.name === 'ReportNotFoundError') throw error(404, 'Report not found');
			throw error(500, 'Failed to get report');
		}
	);
};

export const PATCH: RequestHandler = async ({ params, request, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const body = await request.json();
	const parsed = updateReportInput.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid input');

	const result = await service.updateReport(user, params.id, parsed.data);

	return result.match(
		async (report) => {
			const enriched = await service.enrichReportWithUserData(report, user.id);
			return enriched.match(
				(r) => json(toReportOutput(r)),
				() => {
					throw error(500, 'Failed to enrich report');
				}
			);
		},
		(e) => {
			if (e.name === 'ReportNotFoundError') throw error(404, 'Report not found');
			if (e.name === 'ForbiddenError') throw error(403, 'Forbidden');
			throw error(500, 'Failed to update report');
		}
	);
};

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const result = await service.deleteReport(user, params.id);

	return result.match(
		() => new Response(null, { status: 204 }),
		(e) => {
			if (e.name === 'ReportNotFoundError') throw error(404, 'Report not found');
			if (e.name === 'ForbiddenError') throw error(403, 'Forbidden');
			throw error(500, 'Failed to delete report');
		}
	);
};
