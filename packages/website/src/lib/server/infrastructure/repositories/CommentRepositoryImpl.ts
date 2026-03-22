import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ResultAsync } from 'neverthrow';

import { DatabaseError } from '../../domain/errors/ReportErrors';
import { db } from '../../db/client';
import { reportComments, users } from '../../db/schema';

export interface CommentRow {
	id: string;
	reportId: string;
	parentId: string | null;
	author: { id: string; name: string | null; picture: string | null };
	body: string;
	upvoteCount: number;
	downvoteCount: number;
	createdAt: Date;
	updatedAt: Date;
}

function toCommentRow(row: {
	report_comments: typeof reportComments.$inferSelect;
	users: typeof users.$inferSelect;
}): CommentRow {
	return {
		id: row.report_comments.id,
		reportId: row.report_comments.reportId,
		parentId: row.report_comments.parentId,
		author: { id: row.users.id, name: row.users.name, picture: row.users.picture },
		body: row.report_comments.body,
		upvoteCount: row.report_comments.upvoteCount,
		downvoteCount: row.report_comments.downvoteCount,
		createdAt: row.report_comments.createdAt,
		updatedAt: row.report_comments.updatedAt
	};
}

function buildOrderBy(sort: string) {
	switch (sort) {
		case 'oldest':
			return asc(reportComments.createdAt);
		case 'most_upvoted':
			return desc(reportComments.upvoteCount);
		case 'newest':
		default:
			return desc(reportComments.createdAt);
	}
}

export class CommentRepositoryImpl {
	create(data: {
		reportId: string;
		parentId?: string;
		authorId: string;
		body: string;
	}): ResultAsync<CommentRow, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const id = nanoid();
				const now = new Date();

				await db.insert(reportComments).values({
					id,
					reportId: data.reportId,
					parentId: data.parentId ?? null,
					authorId: data.authorId,
					body: data.body,
					createdAt: now,
					updatedAt: now
				});

				const rows = await db
					.select()
					.from(reportComments)
					.innerJoin(users, eq(reportComments.authorId, users.id))
					.where(eq(reportComments.id, id));

				return toCommentRow(rows[0]);
			})(),
			(error) => new DatabaseError('Failed to create comment', error)
		);
	}

	findById(id: string): ResultAsync<CommentRow | null, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(reportComments)
					.innerJoin(users, eq(reportComments.authorId, users.id))
					.where(and(eq(reportComments.id, id), isNull(reportComments.deletedAt)));

				if (rows.length === 0) return null;

				return toCommentRow(rows[0]);
			})(),
			(error) => new DatabaseError('Failed to find comment', error)
		);
	}

	listByReport(
		reportId: string,
		sort: string,
		limit: number,
		offset: number
	): ResultAsync<CommentRow[], DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(reportComments)
					.innerJoin(users, eq(reportComments.authorId, users.id))
					.where(
						and(eq(reportComments.reportId, reportId), isNull(reportComments.deletedAt))
					)
					.orderBy(buildOrderBy(sort))
					.limit(limit)
					.offset(offset);

				return rows.map(toCommentRow);
			})(),
			(error) => new DatabaseError('Failed to list comments', error)
		);
	}

	countByReport(reportId: string): ResultAsync<number, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				return await db.$count(
					reportComments,
					and(eq(reportComments.reportId, reportId), isNull(reportComments.deletedAt))
				);
			})(),
			(error) => new DatabaseError('Failed to count comments', error)
		);
	}

	update(id: string, data: { body: string }): ResultAsync<CommentRow, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const [comment] = await db
					.update(reportComments)
					.set({ body: data.body, updatedAt: new Date() })
					.where(and(eq(reportComments.id, id), isNull(reportComments.deletedAt)))
					.returning();

				const [user] = await db.select().from(users).where(eq(users.id, comment.authorId));

				return toCommentRow({ report_comments: comment, users: user });
			})(),
			(error) => new DatabaseError('Failed to update comment', error)
		);
	}

	softDelete(id: string): ResultAsync<void, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				await db
					.update(reportComments)
					.set({ deletedAt: new Date() })
					.where(and(eq(reportComments.id, id), isNull(reportComments.deletedAt)));
			})(),
			(error) => new DatabaseError('Failed to delete comment', error)
		);
	}

	incrementCount(
		id: string,
		field: 'upvoteCount' | 'downvoteCount',
		delta: number
	): ResultAsync<void, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				await db
					.update(reportComments)
					.set({
						[field]: sql`GREATEST(0, ${reportComments[field]} + ${delta})`
					})
					.where(eq(reportComments.id, id));
			})(),
			(error) => new DatabaseError(`Failed to increment ${field}`, error)
		);
	}
}
