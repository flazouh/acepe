import { error } from '@sveltejs/kit';

import { validateSession } from '$lib/server/auth/admin';
import { container } from '$lib/server/infrastructure/container';
import type { ReportRow } from '$lib/server/infrastructure/repositories/ReportRepositoryImpl';
import type { CommentRow } from '$lib/server/infrastructure/repositories/CommentRepositoryImpl';

export function getService() {
	return container.getReportsService();
}

export async function requireAuth(cookies: { get(name: string): string | undefined }) {
	const sessionId = cookies.get('session');
	if (!sessionId) throw error(401, 'Unauthorized');
	const user = (await validateSession(sessionId)).unwrapOr(null);
	if (!user) throw error(401, 'Unauthorized');
	return user;
}

export async function optionalAuth(cookies: { get(name: string): string | undefined }) {
	const sessionId = cookies.get('session');
	if (!sessionId) return null;
	return (await validateSession(sessionId)).unwrapOr(null);
}

export function toReportOutput(r: ReportRow & { currentUserVote?: 'up' | 'down' | null; currentUserFollowing?: boolean }) {
	return {
		id: r.id,
		title: r.title,
		body: r.body,
		category: r.category,
		status: r.status,
		author: r.author,
		upvoteCount: r.upvoteCount,
		downvoteCount: r.downvoteCount,
		commentCount: r.commentCount,
		followerCount: r.followerCount,
		isPinned: r.isPinned,
		currentUserVote: r.currentUserVote ?? null,
		currentUserFollowing: r.currentUserFollowing ?? false,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
	};
}

export function toRoadmapCardOutput(r: ReportRow & { currentUserVote?: 'up' | 'down' | null }) {
	return {
		id: r.id,
		title: r.title,
		category: r.category,
		status: r.status,
		upvoteCount: r.upvoteCount,
		currentUserVote: r.currentUserVote !== undefined ? r.currentUserVote : null,
		createdAt: r.createdAt.toISOString()
	};
}

export function toCommentOutput(c: CommentRow & { currentUserVote?: 'up' | 'down' | null }) {
	return {
		id: c.id,
		reportId: c.reportId,
		parentId: c.parentId,
		author: c.author,
		body: c.body,
		upvoteCount: c.upvoteCount,
		downvoteCount: c.downvoteCount,
		currentUserVote: c.currentUserVote ?? null,
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString(),
	};
}
