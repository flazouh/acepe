import { z } from 'zod';
import { authorSchema, paginationParams, paginatedResponse, voteType } from './common.js';

export const createCommentInput = z.object({
	body: z.string().min(1).max(20000),
	parentId: z.string().optional()
});
export type CreateCommentInput = z.infer<typeof createCommentInput>;

export const updateCommentInput = z.object({ body: z.string().min(1).max(20000) });
export type UpdateCommentInput = z.infer<typeof updateCommentInput>;

export const listCommentsParams = paginationParams.extend({
	sort: z.enum(['newest', 'oldest', 'most_upvoted']).default('oldest')
});
export type ListCommentsParams = z.infer<typeof listCommentsParams>;

export interface CommentOutput {
	id: string;
	reportId: string;
	parentId: string | null;
	author: { id: string; name: string | null; picture: string | null };
	body: string;
	upvoteCount: number;
	downvoteCount: number;
	currentUserVote: 'up' | 'down' | null;
	replies?: CommentOutput[];
	createdAt: string;
	updatedAt: string;
}

export const commentOutput: z.ZodType<CommentOutput> = z.lazy(() =>
	z.object({
		id: z.string(),
		reportId: z.string(),
		parentId: z.string().nullable(),
		author: authorSchema,
		body: z.string(),
		upvoteCount: z.number(),
		downvoteCount: z.number(),
		currentUserVote: voteType.nullable(),
		replies: z.array(commentOutput).optional(),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime()
	})
);

export const commentListOutput = paginatedResponse(commentOutput);
export type CommentListOutput = z.infer<typeof commentListOutput>;
