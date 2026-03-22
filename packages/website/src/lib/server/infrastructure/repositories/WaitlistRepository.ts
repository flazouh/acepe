import type { ResultAsync } from 'neverthrow';
import type { Email } from '../../domain/value-objects/Email';
import type { DatabaseError } from '../../domain/errors/WaitlistErrors';

export interface WaitlistEntry {
	id: string;
	email: string;
	locale: string;
	confirmationToken: string;
	emailConfirmed: boolean;
	createdAt: Date;
	confirmedAt: Date | null;
}

export interface WaitlistRepository {
	/**
	 * Add new entry to waitlist
	 */
	add(entry: Omit<WaitlistEntry, 'id' | 'createdAt'>): ResultAsync<WaitlistEntry, DatabaseError>;

	/**
	 * Find entry by email
	 */
	findByEmail(email: Email): ResultAsync<WaitlistEntry | null, DatabaseError>;

	/**
	 * Find entry by confirmation token
	 */
	findByToken(token: string): ResultAsync<WaitlistEntry | null, DatabaseError>;

	/**
	 * Confirm email address
	 */
	confirmEmail(email: Email): ResultAsync<WaitlistEntry, DatabaseError>;

	/**
	 * Get all entries ordered by creation date with pagination
	 */
	getAll(limit: number, offset: number): ResultAsync<ReadonlyArray<WaitlistEntry>, DatabaseError>;

	/**
	 * Get total count of entries
	 */
	getTotalCount(): ResultAsync<number, DatabaseError>;

	/**
	 * Export all entries as CSV
	 */
	exportToCSV(): ResultAsync<string, DatabaseError>;
}
