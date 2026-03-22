import type { SessionUpdate } from "../../services/converted-session-types.js";

/**
 * SessionUpdate type discriminator values.
 * These are the possible values of the `type` field.
 */
export type SessionUpdateType = SessionUpdate["type"];

/**
 * Extract the data type for a specific variant by type discriminator.
 * Uses distributive conditional types to narrow the union.
 */
export type SessionUpdateData<T extends SessionUpdateType> = Extract<SessionUpdate, { type: T }>;

/**
 * Handler map type - requires a handler function for every variant.
 * TypeScript enforces that ALL variants have handlers at compile time.
 */
export type SessionUpdateHandlers<R> = {
	[T in SessionUpdateType]: (data: SessionUpdateData<T>) => R;
};

/**
 * Get the type discriminator from a SessionUpdate instance.
 */
export function getSessionUpdateType(update: SessionUpdate): SessionUpdateType {
	return update.type;
}

/**
 * Type-safe exhaustive pattern matching for SessionUpdate.
 *
 * This provides compile-time guarantees that ALL variants are handled.
 * Missing a variant in the handlers object = TypeScript compile error.
 *
 * @example
 * const result = matchSessionUpdate(update, {
 *     userMessageChunk: (data) => processUser(data),
 *     agentMessageChunk: (data) => processAgent(data),
 *     // ... TypeScript enforces ALL variants are present
 * });
 */
export function matchSessionUpdate<R>(
	update: SessionUpdate,
	handlers: SessionUpdateHandlers<R>
): R {
	const type = update.type;
	// The handler lookup is type-safe due to the SessionUpdateHandlers constraint
	const handler = handlers[type] as (data: SessionUpdate) => R;
	return handler(update);
}
