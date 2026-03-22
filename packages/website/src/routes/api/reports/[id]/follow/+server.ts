import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { getService, requireAuth } from '../../_helpers';

export const PUT: RequestHandler = async ({ params, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const result = await service.followReport(user.id, params.id);

	return result.match(
		() => json({ following: true }),
		() => {
			throw error(500, 'Failed to follow report');
		}
	);
};

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const result = await service.unfollowReport(user.id, params.id);

	return result.match(
		() => json({ following: false }),
		() => {
			throw error(500, 'Failed to unfollow report');
		}
	);
};
