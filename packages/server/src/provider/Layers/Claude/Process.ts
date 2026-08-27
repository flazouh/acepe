import { query, type ModelInfo } from "@anthropic-ai/claude-agent-sdk"
import type { SessionModelCatalog, SessionModelDescriptor } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import type { ProviderAdapterError } from "../../Services/ProviderAdapter.ts"
import type { Json } from "../Json.ts"
import { adapterError, type ClaudeMode } from "./Provider.ts"
import {
	buildClaudeQueryOptions,
	type ClaudeCanUseTool,
	type ClaudeQueryIsolation,
	type ClaudeUserPrompt
} from "./Wire.ts"

export type ClaudeQueryInput = {
	readonly prompt: AsyncIterable<ClaudeUserPrompt>
	readonly cwd: string
	readonly canUseTool: ClaudeCanUseTool
	// The Claude SDK's OWN session id to resume, when recovering a query
	// after a cancel or a watchdog-detected stall — see attachQuery. Absent
	// (None) for a session's very first query, or when no provider session id
	// has been observed yet (the stall happened before the SDK's own init
	// message ever arrived).
	readonly resume: Option.Option<string>
	// The session's canonical mode at the moment this query is created — see
	// buildClaudeQueryOptions' own doc for why the launch options carry it
	// alongside the live setPermissionMode control request below.
	readonly permissionMode: ClaudeMode
	// The session's canonical model, for the same reason the mode is here:
	// setModel only reaches a LIVE query, and a cancel or a stall recovery
	// builds a new one. None means the session never chose a model, and then
	// the SDK runs whatever the operator's own Claude config selects.
	readonly model: Option.Option<string>
}

export type ClaudeQueryHandle = {
	readonly messages: Stream.Stream<Json, ProviderAdapterError>
	readonly interrupt: Effect.Effect<void, ProviderAdapterError>
	// The SDK's own mid-session mode control request. Only available in
	// streaming input mode, which is exactly how makeLiveCreateQuery drives
	// query() (an AsyncIterable prompt), so this is a real transport call and
	// not a stub.
	readonly setPermissionMode: (mode: ClaudeMode) => Effect.Effect<void, ProviderAdapterError>
	// The SDK's own mid-session model control request, streaming-input-only in
	// exactly the same way setPermissionMode is.
	readonly setModel: (model: string) => Effect.Effect<void, ProviderAdapterError>
	// What this session can actually run, asked of the SDK rather than
	// hardcoded beside the picker. Mapped to the contract's own descriptor
	// HERE, at the transport edge, so ModelInfo's field names
	// (value/displayName) stay inside this file.
	readonly supportedModels: Effect.Effect<SessionModelCatalog, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

// ModelInfo's own field names, translated once. The contract calls them
// modelId/name/description; the SDK calls them value/displayName/description.
// A model whose id or display name is blank cannot satisfy the contract's
// TrimmedNonEmptyString, so it is dropped rather than allowed to fail the
// whole catalog's encode -- one unusable entry must not cost the picker every
// other model.
const sessionModelFromInfo = (info: ModelInfo): SessionModelDescriptor => ({
	modelId: info.value,
	name: info.displayName,
	description: info.description
})

const isUsableModel = (model: SessionModelDescriptor): boolean =>
	Str.isNonEmpty(model.modelId.trim()) && Str.isNonEmpty(model.name.trim())

const errorDetail = <A>(cause: A, fallback: string): string => {
	if (Predicate.isError(cause) && Str.isNonEmpty(cause.message)) {
		return cause.message
	}
	return fallback
}

export const makeLiveCreateQuery = (
	isolation: ClaudeQueryIsolation
) =>
(
	input: ClaudeQueryInput
): Effect.Effect<ClaudeQueryHandle, ProviderAdapterError> =>
	Effect.try({
		try: () => {
			const runtime = query({
				prompt: input.prompt,
				options: buildClaudeQueryOptions(input, isolation)
			})
			return {
				messages: Stream.fromAsyncIterable(runtime, (cause) =>
					adapterError("startSession", errorDetail(cause, "Claude query stream failed"))
				).pipe(
					Stream.mapEffect((message) =>
						Schema.decodeUnknownEffect(Schema.Json)(message).pipe(
							Effect.mapError(() =>
								adapterError("startSession", "Claude query message was not JSON")
							)
						)
					)
				),
				interrupt: Effect.tryPromise({
					try: () => runtime.interrupt(),
					catch: (cause) =>
						adapterError("cancelTurn", errorDetail(cause, "Claude interrupt failed"))
				}),
				setPermissionMode: (mode: ClaudeMode) =>
					Effect.tryPromise({
						try: () => runtime.setPermissionMode(mode),
						catch: (cause) =>
							adapterError(
								"setMode",
								errorDetail(cause, "Claude setPermissionMode failed")
							)
					}),
				setModel: (model: string) =>
					Effect.tryPromise({
						try: () => runtime.setModel(model),
						catch: (cause) =>
							adapterError("setModel", errorDetail(cause, "Claude setModel failed"))
					}),
				supportedModels: Effect.tryPromise({
					try: () => runtime.supportedModels(),
					catch: (cause) =>
						adapterError("startSession", errorDetail(cause, "Claude supportedModels failed"))
				}).pipe(
					Effect.map((infos) =>
						Arr.filter(Arr.map(infos, sessionModelFromInfo), isUsableModel)
					)
				),
				close: Effect.sync(() => {
					runtime.close()
				})
			}
		},
		catch: (cause) => adapterError("startSession", errorDetail(cause, "Claude query failed"))
	})

// Tears down a query BOUNDED: interrupt() is the SDK's documented way to
// stop a running turn on a query that will keep accepting prompts, but if
// the SDK's own interrupt promise hangs (the wedge behind the real "cancel
// then the next message hangs forever" QA bug), it must never block the
// caller indefinitely — cancelTurn runs inline on ProviderBridge's single
// shared dispatcher fiber, so an unbounded hang here freezes EVERY session,
// not just this one. close() itself is a synchronous, fire-and-forget call
// (see makeLiveCreateQuery) that can't hang, so only interrupt() needs a
// timeout.
export const teardownQuery = (
	queryHandle: ClaudeQueryHandle,
	interruptTimeout: Duration.Input
) =>
	queryHandle.interrupt.pipe(
		Effect.timeout(interruptTimeout),
		Effect.ignore,
		Effect.andThen(queryHandle.close),
		Effect.ignore
	)
