import { ResultAsync } from 'neverthrow';
import { eq, desc, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/client';
import { waitlistEntries } from '../../db/schema';
import { DatabaseError } from '../../domain/errors/WaitlistErrors';
import type { WaitlistRepository, WaitlistEntry } from './WaitlistRepository';
import type { Email } from '../../domain/value-objects/Email';

export class WaitlistRepositoryImpl implements WaitlistRepository {
	add(entry: Omit<WaitlistEntry, 'id' | 'createdAt'>): ResultAsync<WaitlistEntry, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const id = nanoid();
				const [inserted] = await db
					.insert(waitlistEntries)
					.values({
						id,
						...entry
					})
					.returning();

				return inserted as WaitlistEntry;
			})(),
			(error) => new DatabaseError('Failed to add waitlist entry', error)
		);
	}

	findByEmail(email: Email): ResultAsync<WaitlistEntry | null, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(waitlistEntries)
					.where(eq(waitlistEntries.email, email.getValue()));
				return rows[0] || null;
			})(),
			(error) => new DatabaseError('Failed to find entry by email', error)
		);
	}

	findByToken(token: string): ResultAsync<WaitlistEntry | null, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const rows = await db
					.select()
					.from(waitlistEntries)
					.where(eq(waitlistEntries.confirmationToken, token));
				return rows[0] || null;
			})(),
			(error) => new DatabaseError('Failed to find entry by token', error)
		);
	}

	confirmEmail(email: Email): ResultAsync<WaitlistEntry, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const [updated] = await db
					.update(waitlistEntries)
					.set({
						emailConfirmed: true,
						confirmedAt: new Date()
					})
					.where(eq(waitlistEntries.email, email.getValue()))
					.returning();

				if (!updated) {
					throw new Error('Entry not found');
				}

				return updated as WaitlistEntry;
			})(),
			(error) => new DatabaseError('Failed to confirm email', error)
		);
	}

	getAll(limit: number, offset: number): ResultAsync<ReadonlyArray<WaitlistEntry>, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				return db
					.select()
					.from(waitlistEntries)
					.orderBy(desc(waitlistEntries.createdAt))
					.limit(limit)
					.offset(offset);
			})(),
			(error) => new DatabaseError('Failed to get entries', error)
		);
	}

	getTotalCount(): ResultAsync<number, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const result = await db.select({ count: db.$count(waitlistEntries) }).from(waitlistEntries);
				return result[0]?.count || 0;
			})(),
			(error) => new DatabaseError('Failed to get total count', error)
		);
	}

	exportToCSV(): ResultAsync<string, DatabaseError> {
		return ResultAsync.fromPromise(
			(async () => {
				const entries = await db
					.select()
					.from(waitlistEntries)
					.orderBy(asc(waitlistEntries.createdAt));

				const headers = ['Email', 'Confirmed', 'Created Date', 'Confirmed Date'];
				const rows = entries.map((entry) => [
					entry.email,
					entry.emailConfirmed ? 'Yes' : 'No',
					entry.createdAt.toISOString(),
					entry.confirmedAt?.toISOString() || ''
				]);

				const csv = [
					headers.join(','),
					...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))
				].join('\n');

				return csv;
			})(),
			(error) => new DatabaseError('Failed to export to CSV', error)
		);
	}
}
