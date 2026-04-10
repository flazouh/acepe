import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ResultAsync } from "neverthrow";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import {
	type AuthError,
	SessionCreationFailedError,
	UnauthorizedError,
} from "../domain/errors/AuthErrors";

interface GoogleUserData {
	googleId: string;
	email: string;
	name: string;
	picture: string;
}

interface User {
	id: string;
	email: string;
	googleId: string;
	name: string | null;
	picture: string | null;
	isAdmin: boolean;
}

interface Session {
	id: string;
	userId: string;
	expiresAt: Date;
}

/**
 * Find or create a user by Google OAuth data.
 */
export function findOrCreateUserByGoogle(data: GoogleUserData): ResultAsync<User, AuthError> {
	return ResultAsync.fromPromise(
		(async () => {
			// Check if user exists
			const existingUsers = await db.select().from(users).where(eq(users.googleId, data.googleId));

			if (existingUsers.length > 0) {
				const user = existingUsers[0];
				// Update user info
				await db
					.update(users)
					.set({
						name: data.name,
						picture: data.picture,
						email: data.email,
					})
					.where(eq(users.id, user.id));

				return {
					...user,
					name: data.name,
					picture: data.picture,
					email: data.email,
				};
			}

			// Create new user
			const newUser = {
				id: nanoid(),
				email: data.email,
				googleId: data.googleId,
				name: data.name,
				picture: data.picture,
				isAdmin: false,
			};

			await db.insert(users).values(newUser);

			return newUser;
		})(),
		(error) => new UnauthorizedError(`Failed to authenticate: ${error}`)
	);
}

/**
 * Create a new session for a user
 */
export function createSession(userId: string): ResultAsync<Session, AuthError> {
	return ResultAsync.fromPromise(
		(async () => {
			const session = {
				id: nanoid(),
				userId,
				expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
			};

			await db.insert(sessions).values(session);

			return session;
		})(),
		(error) => new SessionCreationFailedError(`Failed to create session: ${error}`)
	);
}

/**
 * Validate a session and return the user
 */
export function validateSession(sessionId: string): ResultAsync<User | null, AuthError> {
	return ResultAsync.fromPromise(
		(async () => {
			const result = await db
				.select({
					session: sessions,
					user: users,
				})
				.from(sessions)
				.innerJoin(users, eq(sessions.userId, users.id))
				.where(eq(sessions.id, sessionId));

			if (result.length === 0) {
				return null;
			}

			const { session, user } = result[0];

			// Check if session is expired
			if (session.expiresAt < new Date()) {
				await db.delete(sessions).where(eq(sessions.id, sessionId));
				return null;
			}

			return user;
		})(),
		(error) => new UnauthorizedError(`Failed to validate session: ${error}`)
	);
}

/**
 * Delete a session (logout)
 */
export function deleteSession(sessionId: string): ResultAsync<void, AuthError> {
	return ResultAsync.fromPromise(
		(async () => {
			await db.delete(sessions).where(eq(sessions.id, sessionId));
		})(),
		(error) => new UnauthorizedError(`Failed to delete session: ${error}`)
	);
}
