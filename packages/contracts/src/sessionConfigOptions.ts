/**
 * The config option values a session has chosen, as a canonical fact.
 *
 * A `SessionConfigOptionSet` event carries one key and one value (see
 * SessionConfigOptionSetPayload in acp.ts). This map is that event folded:
 * the latest value per key, so replaying a session that changed its
 * reasoning effort three times lands on the third. The keys are the config
 * option ids the provider's own catalog declares (for Claude,
 * `reasoning_effort`), so a reader pairs a canonical value with a
 * provider-owned descriptor, never two answers to the same question.
 */

import * as Schema from "effect/Schema"

export const SessionConfigOptionValues = Schema.Record(Schema.String, Schema.String)
export type SessionConfigOptionValues = typeof SessionConfigOptionValues.Type

/**
 * The values as a projection column holds them: JSON text, decoded back
 * through the same schema that wrote it. Null for a session where no
 * SessionConfigOptionSet ever fired, and for every row written before the
 * column existed.
 */
export const StoredSessionConfigOptionValues = SessionConfigOptionValues.pipe(
	Schema.fromJsonString,
	Schema.NullOr,
)

export const encodeStoredSessionConfigOptionValues = Schema.encodeEffect(
	StoredSessionConfigOptionValues,
)
