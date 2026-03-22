import { z } from 'zod';
import {
	reportCategory,
	reportStatus,
	voteType,
	sortBy,
	paginationParams,
	authorSchema,
	paginatedResponse
} from './common.js';

// --- Input schemas ---

export const createReportInput = z.object({
	title: z.string().min(3).max(200),
	body: z.string().min(10).max(50000),
	category: reportCategory
});
export type CreateReportInput = z.infer<typeof createReportInput>;

export const updateReportInput = z.object({
	title: z.string().min(3).max(200).optional(),
	body: z.string().min(10).max(50000).optional(),
	category: reportCategory.optional()
});
export type UpdateReportInput = z.infer<typeof updateReportInput>;

export const updateReportStatusInput = z.object({ status: reportStatus });
export type UpdateReportStatusInput = z.infer<typeof updateReportStatusInput>;

export const listReportsParams = paginationParams.extend({
	category: reportCategory.optional(),
	status: reportStatus.optional(),
	sort: sortBy.default('newest'),
	authorId: z.string().optional(),
	search: z.string().max(200).optional()
});
export type ListReportsParams = z.infer<typeof listReportsParams>;

// --- Output schemas ---

export const reportOutput = z.object({
	id: z.string(),
	title: z.string(),
	body: z.string(),
	category: reportCategory,
	status: reportStatus,
	author: authorSchema,
	upvoteCount: z.number(),
	downvoteCount: z.number(),
	commentCount: z.number(),
	followerCount: z.number(),
	isPinned: z.boolean(),
	currentUserVote: voteType.nullable(),
	currentUserFollowing: z.boolean(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime()
});
export type ReportOutput = z.infer<typeof reportOutput>;

export const reportListOutput = paginatedResponse(reportOutput);
export type ReportListOutput = z.infer<typeof reportListOutput>;
