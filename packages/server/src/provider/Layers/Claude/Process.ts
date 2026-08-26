import { query, type McpServerConfig, type Options as ClaudeSdkOptions } from "@anthropic-ai/claude-agent-sdk"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import { ProviderAdapterError } from "../../Services/ProviderAdapter.ts"
import {
	CLAUDE_ISOLATED_SETTING_SOURCES,
	CLAUDE_PROVIDER_ID,
	CLAUDE_STRICT_MCP_CONFIG
} from "./Provider.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const EMPTY_JSON_OBJECT: JsonObject = {}

export type ClaudePermissionResult =
	| {
			readonly behavior: "allow"
			readonly updatedInput: JsonObject
	  }
	| {
			readonly behavior: "deny"
			readonly message: string
	  }

export type ClaudeCanUseTool = (
	toolName: string,
	input: JsonObject,
	options: { readonly toolUseID: string }
) => Promise<ClaudePermissionResult>

export type ClaudeUserPrompt = {
	readonly type: "user"
	readonly session_id: string
	readonly parent_tool_use_id: null
	readonly message: {
		readonly role: "user"
		readonly content: string
	}
}

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
}

export type ClaudeQueryHandle = {
	readonly messages: Stream.Stream<Json, ProviderAdapterError>
	readonly interrupt: Effect.Effect<void, ProviderAdapterError>
	readonly close: Effect.Effect<void>
}

export const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: CLAUDE_PROVIDER_ID,
		operation,
		detail
	})

const errorDetail = <A>(cause: A, fallback: string): string => {
	if (Predicate.isError(cause) && Str.isNonEmpty(cause.message)) {
		return cause.message
	}
	return fallback
}

const jsonObjectFromValue = <A>(value: A): JsonObject => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return exit.value
	}
	return EMPTY_JSON_OBJECT
}

export const userPrompt = (
	text: string,
	providerSessionId: Option.Option<string>
): ClaudeUserPrompt => ({
	type: "user",
	session_id: Option.getOrElse(providerSessionId, () => ""),
	parent_tool_use_id: null,
	message: {
		role: "user",
		content: text
	}
})

export type ClaudeQueryIsolation = {
	// When given, points query() at a system claude binary instead of the
	// SDK's own bundled native CLI (an optional platform dependency a
	// bundler's static analysis can't see and drops) — see
	// resolveClaudeExecutablePath in ClaudeProvider.ts for why this exists.
	readonly pathToClaudeCodeExecutable: Option.Option<string>
	// MCP servers Acepe itself wires in for this session, distinct from (and
	// never merged with) the operator's personal ~/.claude.json servers —
	// see CLAUDE_SESSION_MCP_SERVERS in ClaudeProvider.ts.
	readonly mcpServers: Record<string, McpServerConfig>
}

// Builds the exact options object passed to the SDK's query(). Pulled out as
// a pure function (no SDK call, no process spawn) so the isolation settings
// can be unit-tested directly instead of only through a live spawn.
//
// settingSources excludes the operator's 'user'-scoped config
// (~/.claude/settings.json — hooks) while keeping 'project'/'local' (the
// target repo's own CLAUDE.md / .claude/settings.json, legitimate task
// context). strictMcpConfig + the explicit mcpServers below stop the
// operator's ~/.claude.json personal MCP servers (a railway server, a
// personal-memory venv server, ...) from being inherited. Both settings were
// verified empirically against the real SDK: the defaults (neither set)
// spawn the operator's personal MCP server child processes on the first
// turn; either setting alone, and the combination, block that spawn while
// still returning a real reply. See CLAUDE_ISOLATED_SETTING_SOURCES and
// CLAUDE_STRICT_MCP_CONFIG in ClaudeProvider.ts for the fuller rationale.
export const buildClaudeQueryOptions = (
	input: {
		readonly cwd: string
		readonly canUseTool: ClaudeCanUseTool
		readonly resume?: Option.Option<string>
	},
	isolation: ClaudeQueryIsolation
): ClaudeSdkOptions => ({
	cwd: input.cwd,
	includePartialMessages: true,
	settingSources: [...CLAUDE_ISOLATED_SETTING_SOURCES],
	strictMcpConfig: CLAUDE_STRICT_MCP_CONFIG,
	mcpServers: isolation.mcpServers,
	...(Option.isSome(isolation.pathToClaudeCodeExecutable)
		? { pathToClaudeCodeExecutable: isolation.pathToClaudeCodeExecutable.value }
		: {}),
	...(input.resume !== undefined && Option.isSome(input.resume)
		? { resume: input.resume.value }
		: {}),
	canUseTool: (toolName, toolInput, options) =>
		input.canUseTool(toolName, jsonObjectFromValue(toolInput), {
			toolUseID: options.toolUseID
		})
})

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
