import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ResultAsync } from 'neverthrow';

import { DatabaseError } from '../../domain/errors/ReportErrors';
import { db } from '../../db/client';
import { reportFollowers } from '../../db/schema';

export class FollowerRepositoryImpl {
	isFollowing(userId: string, reportId: string): ResultAsync<boolean, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(reportFollowers)
					.where(
						and(
							eq(reportFollowers.userId, userId),
							eq(reportFollowers.reportId, reportId)
						)
					);

				return rows.length > 0;
			})(),
			(error) => new DatabaseError('Failed to check follow status', error)
		);
	}

	isFollowingMany(
		userId: string,
		reportIds: string[]
	): ResultAsync<Set<string>, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				if (reportIds.length === 0) return new Set<string>();

				const rows = await db
					.select()
					.from(reportFollowers)
					.where(
						and(
							eq(reportFollowers.userId, userId),
							inArray(reportFollowers.reportId, reportIds)
						)
					);

				return new Set(rows.map((row) => row.reportId));
			})(),
			(error) => new DatabaseError('Failed to check follow status for multiple reports', error)
		);
	}

	follow(userId: string, reportId: string): ResultAsync<{ inserted: boolean }, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const result = await db
					.insert(reportFollowers)
					.values({
						id: nanoid(),
						userId,
						reportId
					})
					.onConflictDoNothing()
					.returning();

				return { inserted: result.length > 0 };
			})(),
			(error) => new DatabaseError('Failed to follow report', error)
		);
	}

	unfollow(userId: string, reportId: string): ResultAsync<{ deleted: boolean }, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const result = await db
					.delete(reportFollowers)
					.where(
						and(
							eq(reportFollowers.userId, userId),
							eq(reportFollowers.reportId, reportId)
						)
					)
					.returning();

				return { deleted: result.length > 0 };
			})(),
			(error) => new DatabaseError('Failed to unfollow report', error)
		);
	}
}
