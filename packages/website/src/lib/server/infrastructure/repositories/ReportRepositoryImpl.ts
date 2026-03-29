import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ResultAsync } from 'neverthrow';

import { DatabaseError } from '../../domain/errors/ReportErrors';
import { db } from '../../db/client';
import { reports, users } from '../../db/schema';

export interface ReportRow {
	id: string;
	title: string;
	body: string;
	category: 'bug' | 'feature_request' | 'question' | 'discussion';
	status: 'open' | 'under_review' | 'planned' | 'in_progress' | 'completed' | 'closed' | 'wont_fix';
	author: { id: string; name: string | null; picture: string | null };
	upvoteCount: number;
	downvoteCount: number;
	commentCount: number;
	followerCount: number;
	isPinned: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface ReportFilters {
	category?: string;
	status?: string;
	authorId?: string;
	search?: string;
}

function toReportRow(report: typeof reports.$inferSelect, user: typeof users.$inferSelect): ReportRow {
	return {
		id: report.id,
		title: report.title,
		body: report.body,
		category: report.category,
		status: report.status,
		author: { id: user.id, name: user.name, picture: user.picture },
		upvoteCount: report.upvoteCount,
		downvoteCount: report.downvoteCount,
		commentCount: report.commentCount,
		followerCount: report.followerCount,
		isPinned: report.isPinned,
		createdAt: report.createdAt,
		updatedAt: report.updatedAt
	};
}

function buildWhereConditions(filters: ReportFilters) {
	const conditions = [isNull(reports.deletedAt)];

	if (filters.category) {
		conditions.push(eq(reports.category, filters.category as typeof reports.category.enumValues[number]));
	}
	if (filters.status) {
		conditions.push(eq(reports.status, filters.status as typeof reports.status.enumValues[number]));
	}
	if (filters.authorId) {
		conditions.push(eq(reports.authorId, filters.authorId));
	}
	if (filters.search) {
		const escaped = filters.search.replace(/[%_\\]/g, '\\$&');
		const pattern = `%${escaped}%`;
		conditions.push(or(like(reports.title, pattern), like(reports.body, pattern))!);
	}

	return and(...conditions);
}

function buildOrderBy(sort: string) {
	switch (sort) {
		case 'oldest':
			return asc(reports.createdAt);
		case 'most_upvoted':
			return desc(reports.upvoteCount);
		case 'most_commented':
			return desc(reports.commentCount);
		case 'trending':
			return sql`(${reports.upvoteCount} - ${reports.downvoteCount}) / pow(extract(epoch from now() - ${reports.createdAt}) / 3600 + 2, 1.8) desc`;
		default:
			return desc(reports.createdAt);
	}
}

export class ReportRepositoryImpl {
	create(data: {
		title: string;
		body: string;
		category: string;
		authorId: string;
	}): ResultAsync<ReportRow, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const id = nanoid();
				const now = new Date();

				const [report] = await db
					.insert(reports)
					.values({
						id,
						title: data.title,
						body: data.body,
						category: data.category as typeof reports.category.enumValues[number],
						authorId: data.authorId,
						createdAt: now,
						updatedAt: now
					})
					.returning();

				const [user] = await db.select().from(users).where(eq(users.id, data.authorId));

				return toReportRow(report, user);
			})(),
			(error) => new DatabaseError('Failed to create report', error)
		);
	}

	findById(id: string): ResultAsync<ReportRow | null, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(reports)
					.innerJoin(users, eq(reports.authorId, users.id))
					.where(and(eq(reports.id, id), isNull(reports.deletedAt)));

				if (rows.length === 0) return null;

				return toReportRow(rows[0].reports, rows[0].users);
			})(),
			(error) => new DatabaseError('Failed to find report', error)
		);
	}

	list(
		filters: ReportFilters,
		sort: string,
		limit: number,
		offset: number
	): ResultAsync<ReportRow[], DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(reports)
					.innerJoin(users, eq(reports.authorId, users.id))
					.where(buildWhereConditions(filters))
					.orderBy(buildOrderBy(sort))
					.limit(limit)
					.offset(offset);

				return rows.map((row) => toReportRow(row.reports, row.users));
			})(),
			(error) => new DatabaseError('Failed to list reports', error)
		);
	}

	count(filters: ReportFilters): ResultAsync<number, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				return await db.$count(reports, buildWhereConditions(filters));
			})(),
			(error) => new DatabaseError('Failed to count reports', error)
		);
	}

	update(
		id: string,
		data: Partial<{
			title: string;
			body: string;
			category: string;
			status: string;
			isPinned: boolean;
		}>
	): ResultAsync<ReportRow, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const updateData: Record<string, unknown> = { updatedAt: new Date() };

				if (data.title !== undefined) updateData.title = data.title;
				if (data.body !== undefined) updateData.body = data.body;
				if (data.category !== undefined) updateData.category = data.category;
				if (data.status !== undefined) updateData.status = data.status;
				if (data.isPinned !== undefined) updateData.isPinned = data.isPinned;

				const [report] = await db
					.update(reports)
					.set(updateData)
					.where(and(eq(reports.id, id), isNull(reports.deletedAt)))
					.returning();

				const [user] = await db.select().from(users).where(eq(users.id, report.authorId));

				return toReportRow(report, user);
			})(),
			(error) => new DatabaseError('Failed to update report', error)
		);
	}

	softDelete(id: string): ResultAsync<void, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				await db
					.update(reports)
					.set({ deletedAt: new Date() })
					.where(and(eq(reports.id, id), isNull(reports.deletedAt)));
			})(),
			(error) => new DatabaseError('Failed to delete report', error)
		);
	}

	incrementCount(
		id: string,
		field: 'commentCount' | 'followerCount' | 'upvoteCount' | 'downvoteCount',
		delta: number
	): ResultAsync<void, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				await db
					.update(reports)
					.set({
						[field]: sql`GREATEST(0, ${reports[field]} + ${delta})`
					})
					.where(eq(reports.id, id));
			})(),
			(error) => new DatabaseError(`Failed to increment ${field}`, error)
		);
	}
}
