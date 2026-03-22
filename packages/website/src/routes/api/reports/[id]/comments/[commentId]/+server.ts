import { error, json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { updateCommentInput } from '@acepe/api';
import { getService, requireAuth, toCommentOutput } from '../../../_helpers';

export const PATCH: RequestHandler = async ({ params, request, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const body = await request.json();
	const parsed = updateCommentInput.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid request body');

	const result = await service.updateComment(user, params.commentId, parsed.data);

	return result.match(
		(comment) => json(toCommentOutput(comment)),
		(e) => {
			if (e.name === 'CommentNotFoundError') throw error(404, 'Comment not found');
			if (e.name === 'ForbiddenError') throw error(403, 'Forbidden');
			throw error(500, 'Internal server error');
		}
	);
};

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const service = getService();
	const user = await requireAuth(cookies);

	const result = await service.deleteComment(user, params.id, params.commentId);

	return result.match(
		() => new Response(null, { status: 204 }),
		(e) => {
			if (e.name === 'CommentNotFoundError') throw error(404, 'Comment not found');
			if (e.name === 'ForbiddenError') throw error(403, 'Forbidden');
			throw error(500, 'Internal server error');
		}
	);
};
