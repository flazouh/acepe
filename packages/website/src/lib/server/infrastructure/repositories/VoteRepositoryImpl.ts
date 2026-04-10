import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ResultAsync } from "neverthrow";
import { db } from "../../db/client";
import { reportVotes } from "../../db/schema";
import { DatabaseError } from "../../domain/errors/ReportErrors";

type VoteType = "up" | "down";
type VoteTarget =
	| { reportId: string; commentId?: undefined }
	| { commentId: string; reportId?: undefined };

function targetCondition(userId: string, target: VoteTarget) {
	if ("reportId" in target && target.reportId) {
		return and(eq(reportVotes.userId, userId), eq(reportVotes.reportId, target.reportId));
	}

	if ("commentId" in target && target.commentId) {
		return and(eq(reportVotes.userId, userId), eq(reportVotes.commentId, target.commentId));
	}

	throw new Error("Vote target must include either reportId or commentId");
}

function castVote(
	userId: string,
	target: VoteTarget,
	voteType: VoteType
): ResultAsync<{ oldVote: VoteType | null }, DatabaseError> {
	return ResultAsync.fromPromise(
		db.transaction(async (tx) => {
			const existing = await tx.select().from(reportVotes).where(targetCondition(userId, target));

			const oldVote = existing.length > 0 ? existing[0].voteType : null;

			if (existing.length > 0) {
				await tx.delete(reportVotes).where(targetCondition(userId, target));
			}

			await tx.insert(reportVotes).values({
				id: nanoid(),
				userId,
				...target,
				voteType,
			});

			return { oldVote };
		}),
		(error) => new DatabaseError("Failed to cast vote", error)
	);
}

function removeVote(
	userId: string,
	target: VoteTarget
): ResultAsync<{ oldVote: VoteType | null }, DatabaseError> {
	return ResultAsync.fromPromise(
		db.transaction(async (tx) => {
			const existing = await tx.select().from(reportVotes).where(targetCondition(userId, target));

			const oldVote = existing.length > 0 ? existing[0].voteType : null;

			await tx.delete(reportVotes).where(targetCondition(userId, target));

			return { oldVote };
		}),
		(error) => new DatabaseError("Failed to remove vote", error)
	);
}

export class VoteRepositoryImpl {
	findUserVoteOnReport(
		userId: string,
		reportId: string
	): ResultAsync<VoteType | null, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(reportVotes)
					.where(and(eq(reportVotes.userId, userId), eq(reportVotes.reportId, reportId)));

				return rows.length > 0 ? rows[0].voteType : null;
			})(),
			(error) => new DatabaseError("Failed to find user vote on report", error)
		);
	}

	findUserVoteOnComment(
		userId: string,
		commentId: string
	): ResultAsync<VoteType | null, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(reportVotes)
					.where(and(eq(reportVotes.userId, userId), eq(reportVotes.commentId, commentId)));

				return rows.length > 0 ? rows[0].voteType : null;
			})(),
			(error) => new DatabaseError("Failed to find user vote on comment", error)
		);
	}

	findUserVotesOnReports(
		userId: string,
		reportIds: string[]
	): ResultAsync<Map<string, VoteType>, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				if (reportIds.length === 0) return new Map();

				const rows = await db
					.select()
					.from(reportVotes)
					.where(and(eq(reportVotes.userId, userId), inArray(reportVotes.reportId, reportIds)));

				const map = new Map<string, VoteType>();
				for (const row of rows) {
					if (row.reportId) map.set(row.reportId, row.voteType);
				}
				return map;
			})(),
			(error) => new DatabaseError("Failed to find user votes on reports", error)
		);
	}

	findUserVotesOnComments(
		userId: string,
		commentIds: string[]
	): ResultAsync<Map<string, VoteType>, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				if (commentIds.length === 0) return new Map();

				const rows = await db
					.select()
					.from(reportVotes)
					.where(and(eq(reportVotes.userId, userId), inArray(reportVotes.commentId, commentIds)));

				const map = new Map<string, VoteType>();
				for (const row of rows) {
					if (row.commentId) map.set(row.commentId, row.voteType);
				}
				return map;
			})(),
			(error) => new DatabaseError("Failed to find user votes on comments", error)
		);
	}

	castReportVote(userId: string, reportId: string, voteType: VoteType) {
		return castVote(userId, { reportId }, voteType);
	}

	removeReportVote(userId: string, reportId: string) {
		return removeVote(userId, { reportId });
	}

	castCommentVote(userId: string, commentId: string, voteType: VoteType) {
		return castVote(userId, { commentId }, voteType);
	}

	removeCommentVote(userId: string, commentId: string) {
		return removeVote(userId, { commentId });
	}
}
