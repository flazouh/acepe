import { ResultAsync, okAsync, errAsync } from 'neverthrow';
import type { ReportRepositoryImpl, ReportRow, ReportFilters } from '../infrastructure/repositories/ReportRepositoryImpl';
import type { CommentRepositoryImpl, CommentRow } from '../infrastructure/repositories/CommentRepositoryImpl';
import type { VoteRepositoryImpl } from '../infrastructure/repositories/VoteRepositoryImpl';
import type { FollowerRepositoryImpl } from '../infrastructure/repositories/FollowerRepositoryImpl';
import {
	ReportNotFoundError,
	CommentNotFoundError,
	ForbiddenError,
	InvalidReplyDepthError,
	type ReportError
} from '../domain/errors/ReportErrors';

interface User {
	id: string;
	isAdmin: boolean;
}

export class ReportsApplicationService {
	constructor(
		private readonly reportRepo: ReportRepositoryImpl,
		private readonly commentRepo: CommentRepositoryImpl,
		private readonly voteRepo: VoteRepositoryImpl,
		private readonly followerRepo: FollowerRepositoryImpl
	) {}

	// --- Reports ---

	createReport(
		user: User,
		data: { title: string; body: string; category: string }
	): ResultAsync<ReportRow, ReportError> {
		return this.reportRepo
			.create({ ...data, authorId: user.id })
			.andThen((report) =>
				this.followerRepo
					.follow(user.id, report.id)
					.andThen(({ inserted }) =>
						inserted
							? this.reportRepo.incrementCount(report.id, 'followerCount', 1)
							: okAsync(undefined as void)
					)
					.map(() => report)
			);
	}

	getReport(id: string): ResultAsync<ReportRow, ReportError> {
		return this.reportRepo.findById(id).andThen((report) => {
			if (!report) return errAsync(new ReportNotFoundError(id));
			return okAsync(report);
		});
	}

	listReports(
		filters: ReportFilters,
		sort: string,
		page: number,
		limit: number
	): ResultAsync<{ items: ReportRow[]; totalCount: number }, ReportError> {
		const offset = (page - 1) * limit;
		return this.reportRepo
			.list(filters, sort, limit, offset)
			.andThen((items) =>
				this.reportRepo.count(filters).map((totalCount) => ({ items, totalCount }))
			);
	}

	updateReport(
		user: User,
		reportId: string,
		data: Partial<{ title: string; body: string; category: string }>
	): ResultAsync<ReportRow, ReportError> {
		return this.reportRepo.findById(reportId).andThen((report) => {
			if (!report) return errAsync(new ReportNotFoundError(reportId));
			if (report.author.id !== user.id) return errAsync(new ForbiddenError());
			return this.reportRepo.update(reportId, data);
		});
	}

	deleteReport(user: User, reportId: string): ResultAsync<void, ReportError> {
		return this.reportRepo.findById(reportId).andThen((report) => {
			if (!report) return errAsync(new ReportNotFoundError(reportId));
			if (report.author.id !== user.id && !user.isAdmin) return errAsync(new ForbiddenError());
			return this.reportRepo.softDelete(reportId);
		});
	}

	updateStatus(
		user: User,
		reportId: string,
		status: string
	): ResultAsync<ReportRow, ReportError> {
		if (!user.isAdmin) return errAsync(new ForbiddenError());
		return this.reportRepo.findById(reportId).andThen((report) => {
			if (!report) return errAsync(new ReportNotFoundError(reportId));
			return this.reportRepo.update(reportId, { status });
		});
	}

	// --- Votes on Reports ---

	castReportVote(
		userId: string,
		reportId: string,
		voteType: 'up' | 'down'
	): ResultAsync<void, ReportError> {
		return this.voteRepo.castReportVote(userId, reportId, voteType).andThen(({ oldVote }) => {
			let upDelta = 0;
			let downDelta = 0;

			if (oldVote === 'up') upDelta--;
			if (oldVote === 'down') downDelta--;
			if (voteType === 'up') upDelta++;
			if (voteType === 'down') downDelta++;

			const updates: ResultAsync<void, ReportError>[] = [];
			if (upDelta !== 0) updates.push(this.reportRepo.incrementCount(reportId, 'upvoteCount', upDelta));
			if (downDelta !== 0) updates.push(this.reportRepo.incrementCount(reportId, 'downvoteCount', downDelta));

			return ResultAsync.combine(updates).map(() => undefined);
		});
	}

	removeReportVote(userId: string, reportId: string): ResultAsync<void, ReportError> {
		return this.voteRepo.removeReportVote(userId, reportId).andThen(({ oldVote }) => {
			if (!oldVote) return okAsync(undefined as void);
			const field = oldVote === 'up' ? 'upvoteCount' : 'downvoteCount';
			return this.reportRepo.incrementCount(reportId, field, -1);
		});
	}

	// --- Follow ---

	followReport(userId: string, reportId: string): ResultAsync<void, ReportError> {
		return this.followerRepo
			.follow(userId, reportId)
			.andThen(({ inserted }) =>
				inserted
					? this.reportRepo.incrementCount(reportId, 'followerCount', 1)
					: okAsync(undefined as void)
			);
	}

	unfollowReport(userId: string, reportId: string): ResultAsync<void, ReportError> {
		return this.followerRepo
			.unfollow(userId, reportId)
			.andThen(({ deleted }) =>
				deleted
					? this.reportRepo.incrementCount(reportId, 'followerCount', -1)
					: okAsync(undefined as void)
			);
	}

	// --- Comments ---

	createComment(
		user: User,
		reportId: string,
		data: { body: string; parentId?: string }
	): ResultAsync<CommentRow, ReportError> {
		const checkParent: ResultAsync<CommentRow | null, ReportError> = data.parentId
			? this.commentRepo.findById(data.parentId).andThen((parent) => {
					if (!parent) return errAsync(new CommentNotFoundError(data.parentId!));
					if (parent.parentId !== null) return errAsync(new InvalidReplyDepthError());
					return okAsync(parent as CommentRow | null);
				})
			: okAsync(null);

		return checkParent.andThen(() =>
			this.commentRepo
				.create({ reportId, authorId: user.id, body: data.body, parentId: data.parentId })
				.andThen((comment) =>
					this.reportRepo.incrementCount(reportId, 'commentCount', 1).map(() => comment)
				)
		);
	}

	listComments(
		reportId: string,
		sort: string,
		page: number,
		limit: number
	): ResultAsync<{ items: CommentRow[]; totalCount: number }, ReportError> {
		const offset = (page - 1) * limit;
		return this.commentRepo
			.listByReport(reportId, sort, limit, offset)
			.andThen((items) =>
				this.commentRepo.countByReport(reportId).map((totalCount) => ({ items, totalCount }))
			);
	}

	updateComment(
		user: User,
		commentId: string,
		data: { body: string }
	): ResultAsync<CommentRow, ReportError> {
		return this.commentRepo.findById(commentId).andThen((comment) => {
			if (!comment) return errAsync(new CommentNotFoundError(commentId));
			if (comment.author.id !== user.id) return errAsync(new ForbiddenError());
			return this.commentRepo.update(commentId, data);
		});
	}

	deleteComment(
		user: User,
		reportId: string,
		commentId: string
	): ResultAsync<void, ReportError> {
		return this.commentRepo.findById(commentId).andThen((comment) => {
			if (!comment) return errAsync(new CommentNotFoundError(commentId));
			if (comment.author.id !== user.id && !user.isAdmin) return errAsync(new ForbiddenError());
			return this.commentRepo
				.softDelete(commentId)
				.andThen(() => this.reportRepo.incrementCount(reportId, 'commentCount', -1));
		});
	}

	// --- Votes on Comments ---

	castCommentVote(
		userId: string,
		commentId: string,
		voteType: 'up' | 'down'
	): ResultAsync<void, ReportError> {
		return this.voteRepo.castCommentVote(userId, commentId, voteType).andThen(({ oldVote }) => {
			let upDelta = 0;
			let downDelta = 0;

			if (oldVote === 'up') upDelta--;
			if (oldVote === 'down') downDelta--;
			if (voteType === 'up') upDelta++;
			if (voteType === 'down') downDelta++;

			const updates: ResultAsync<void, ReportError>[] = [];
			if (upDelta !== 0) updates.push(this.commentRepo.incrementCount(commentId, 'upvoteCount', upDelta));
			if (downDelta !== 0) updates.push(this.commentRepo.incrementCount(commentId, 'downvoteCount', downDelta));

			return ResultAsync.combine(updates).map(() => undefined);
		});
	}

	removeCommentVote(userId: string, commentId: string): ResultAsync<void, ReportError> {
		return this.voteRepo.removeCommentVote(userId, commentId).andThen(({ oldVote }) => {
			if (!oldVote) return okAsync(undefined as void);
			const field = oldVote === 'up' ? 'upvoteCount' : 'downvoteCount';
			return this.commentRepo.incrementCount(commentId, field, -1);
		});
	}

	// --- Enrichment helpers for API layer ---

	enrichReportWithUserData(
		report: ReportRow,
		userId: string | null
	): ResultAsync<
		ReportRow & { currentUserVote: 'up' | 'down' | null; currentUserFollowing: boolean },
		ReportError
	> {
		if (!userId) {
			return okAsync({ ...report, currentUserVote: null as 'up' | 'down' | null, currentUserFollowing: false });
		}

		return this.voteRepo
			.findUserVoteOnReport(userId, report.id)
			.andThen((vote) =>
				this.followerRepo
					.isFollowing(userId, report.id)
					.map((following) => ({ ...report, currentUserVote: vote, currentUserFollowing: following }))
			);
	}

	enrichReportsWithUserData(
		reports: ReportRow[],
		userId: string | null
	): ResultAsync<
		(ReportRow & { currentUserVote: 'up' | 'down' | null; currentUserFollowing: boolean })[],
		ReportError
	> {
		if (!userId || reports.length === 0) {
			return okAsync(
				reports.map((r) => ({ ...r, currentUserVote: null as 'up' | 'down' | null, currentUserFollowing: false }))
			);
		}

		const ids = reports.map((r) => r.id);
		return this.voteRepo
			.findUserVotesOnReports(userId, ids)
			.andThen((voteMap) =>
				this.followerRepo.isFollowingMany(userId, ids).map((followSet) =>
					reports.map((r) => ({
						...r,
						currentUserVote: voteMap.get(r.id) ?? null,
						currentUserFollowing: followSet.has(r.id)
					}))
				)
			);
	}

	enrichCommentsWithUserData(
		comments: CommentRow[],
		userId: string | null
	): ResultAsync<
		(CommentRow & { currentUserVote: 'up' | 'down' | null })[],
		ReportError
	> {
		if (!userId || comments.length === 0) {
			return okAsync(
				comments.map((c) => ({ ...c, currentUserVote: null as 'up' | 'down' | null }))
			);
		}

		const ids = comments.map((c) => c.id);
		return this.voteRepo.findUserVotesOnComments(userId, ids).map((voteMap) =>
			comments.map((c) => ({
				...c,
				currentUserVote: voteMap.get(c.id) ?? null
			}))
		);
	}
}
