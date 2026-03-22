import { z } from 'zod';

export const reportCategory = z.enum(['bug', 'feature_request', 'question', 'discussion']);
export type ReportCategory = z.infer<typeof reportCategory>;

export const reportStatus = z.enum([
	'open',
	'under_review',
	'planned',
	'in_progress',
	'completed',
	'closed',
	'wont_fix'
]);
export type ReportStatus = z.infer<typeof reportStatus>;

export const voteType = z.enum(['up', 'down']);
export type VoteType = z.infer<typeof voteType>;

export const sortBy = z.enum(['newest', 'oldest', 'most_upvoted', 'most_commented', 'trending']);
export type SortBy = z.infer<typeof sortBy>;

export const paginationParams = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const authorSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	picture: z.string().nullable()
});
export type Author = z.infer<typeof authorSchema>;

export function paginatedResponse<T extends z.ZodType>(itemSchema: T) {
	return z.object({
		items: z.array(itemSchema),
		page: z.number(),
		limit: z.number(),
		totalCount: z.number(),
		totalPages: z.number()
	});
}
