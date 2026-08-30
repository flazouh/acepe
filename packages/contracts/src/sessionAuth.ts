/**
 * A provider that answered a turn with "sign in first", as a canonical fact.
 *
 * The Claude CLI reports a signed-out account as an ordinary assistant reply
 * ("Not logged in · Please run /login") on a turn that then completes, so
 * nothing downstream could tell an auth failure from a real answer and the
 * app never offered its own sign-in flow. The adapter is the one place that
 * may know the provider's rendering of that state (provider quirks stay at
 * the transport edge), and it publishes THIS shape onto a SessionMetaUpdated
 * event's metadata -- the same channel the session_models fact rides -- so
 * every reader downstream reacts to a typed fact instead of matching UI
 * strings.
 */

import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export const SessionAuthRequiredFact = Schema.Struct({
	contractKind: Schema.Literal("auth_required"),
})
export type SessionAuthRequiredFact = typeof SessionAuthRequiredFact.Type

export const sessionAuthRequiredFact: SessionAuthRequiredFact = {
	contractKind: "auth_required",
}

/**
 * Whether an event's metadata carries the auth-required fact. False means
 * "this event said nothing about authentication", never "this session is
 * signed in": the metadata bag rides many events, and silence is not a
 * verdict.
 */
export const sessionAuthRequiredFromMetadata = (metadata: unknown): boolean =>
	Option.isSome(Schema.decodeUnknownOption(SessionAuthRequiredFact)(metadata))
