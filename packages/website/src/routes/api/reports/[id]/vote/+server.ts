import { error } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { castVoteInput } from '@acepe/api';
import { getService, requireAuth } from '../../_helpers';

export const PUT: RequestHandler = async ({ params, request, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const body = await request.json();
	const parsed = castVoteInput.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid input');

	const result = await service.castReportVote(user.id, params.id, parsed.data.voteType);

	return result.match(
		() => new Response(null, { status: 204 }),
		() => {
			throw error(500, 'Failed to cast vote');
		}
	);
};

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const result = await service.removeReportVote(user.id, params.id);

	return result.match(
		() => new Response(null, { status: 204 }),
		() => {
			throw error(500, 'Failed to remove vote');
		}
	);
};
