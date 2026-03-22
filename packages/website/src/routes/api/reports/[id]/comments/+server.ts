import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { createCommentInput, listCommentsParams } from '@acepe/api';
import { getService, optionalAuth, requireAuth, toCommentOutput } from '../../_helpers';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const service = getService();
	const user = await optionalAuth(cookies);

	const parsed = listCommentsParams.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) throw error(400, 'Invalid query parameters');

	const { sort, page, limit } = parsed.data;

	const result = await service.listComments(params.id, sort, page, limit);

	return result.match(
		async ({ items, totalCount }) => {
			const enriched = await service.enrichCommentsWithUserData(items, user?.id ?? null);
			return enriched.match(
				(enrichedItems) =>
					json({
						items: enrichedItems.map(toCommentOutput),
						page,
						limit,
						totalCount,
						totalPages: Math.ceil(totalCount / limit),
					}),
				() => {
					throw error(500, 'Failed to enrich comments');
				}
			);
		},
		() => {
			throw error(500, 'Failed to list comments');
		}
	);
};

export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const body = await request.json();
	const parsed = createCommentInput.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid request body');

	const result = await service.createComment(user, params.id, parsed.data);

	return result.match(
		async (comment) => {
			const enriched = await service.enrichCommentsWithUserData([comment], user.id);
			return enriched.match(
				([enrichedComment]) => json(toCommentOutput(enrichedComment), { status: 201 }),
				() => {
					throw error(500, 'Failed to enrich comment');
				}
			);
		},
		(e) => {
			if (e.name === 'CommentNotFoundError') throw error(404, 'Parent comment not found');
			if (e.name === 'InvalidReplyDepthError') throw error(400, 'Cannot reply to a reply');
			throw error(500, 'Failed to create comment');
		}
	);
};
