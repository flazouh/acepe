import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { updateReportStatusInput } from '@acepe/api';
import { getService, requireAuth, toReportOutput } from '../../_helpers';

export const PATCH: RequestHandler = async ({ params, request, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const body = await request.json();
	const parsed = updateReportStatusInput.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid input');

	const result = await service.updateStatus(user, params.id, parsed.data.status);

	return result.match(
		(r) => json(toReportOutput(r)),
		(e) => {
			if (e.name === 'ReportNotFoundError') throw error(404, 'Report not found');
			if (e.name === 'ForbiddenError') throw error(403, 'Forbidden');
			throw error(500, 'Failed to update report status');
		}
	);
};
