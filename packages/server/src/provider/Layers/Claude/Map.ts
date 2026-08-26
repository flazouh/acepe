import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import {
	type ClaudeAcpToolKind,
	type ClaudeCompactionStatus,
	type ClaudeCompactionTrigger,
	type ClaudeContractFact,
	type CompactionFact,
	type PermissionRequestFact,
	type UsageFact
} from "./Facts.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const EMPTY_JSON_OBJECT: JsonObject = {}

const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const isJsonArray = Schema.is(Schema.Array(Schema.Json))

export type StreamToolBlock = {
	readonly index: number
	readonly toolCallId: string
	readonly toolName: string
}

export type ClaudeStreamState = {
	readonly sawTextDelta: boolean
	readonly sawThinkingDelta: boolean
	readonly toolBlocks: ReadonlyArray<StreamToolBlock>
	readonly providerSessionId: Option.Option<string>
}

export const emptyClaudeStreamState: ClaudeStreamState = {
	sawTextDelta: false,
	sawThinkingDelta: false,
	toolBlocks: Arr.empty(),
	providerSessionId: Option.none()
}

export type ClaudeMapResult = {
	readonly facts: ReadonlyArray<ClaudeContractFact>
	readonly state: ClaudeStreamState
}

export const jsonObjectOf = (value: Json): Option.Option<JsonObject> => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return Option.some(exit.value)
	}
	return Option.none()
}

const field = (record: JsonObject, key: string): Option.Option<Json> => {
	const value = record[key]
	if (value === undefined) {
		return Option.none()
	}
	return Option.some(value)
}

export const stringField = (record: JsonObject, key: string): Option.Option<string> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isString(value) && Str.isNonEmpty(Str.trim(value))
			? Option.some(value)
			: Option.none()
	)

const stringFieldAny = (record: JsonObject, keys: ReadonlyArray<string>): Option.Option<string> =>
	Arr.reduce(keys, Option.none<string>(), (found, key) =>
		Option.isSome(found) ? found : stringField(record, key)
	)

const numberField = (record: JsonObject, key: string): Option.Option<number> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isNumber(value) ? Option.some(value) : Option.none()
	)

const numberFieldAny = (record: JsonObject, keys: ReadonlyArray<string>): Option.Option<number> =>
	Arr.reduce(keys, Option.none<number>(), (found, key) =>
		Option.isSome(found) ? found : numberField(record, key)
	)

export const booleanField = (record: JsonObject, key: string): Option.Option<boolean> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isBoolean(value) ? Option.some(value) : Option.none()
	)

export const objectField = (record: JsonObject, key: string): Option.Option<JsonObject> =>
	Option.flatMap(field(record, key), jsonObjectOf)

const withProviderSession = (
	state: ClaudeStreamState,
	sessionId: Option.Option<string>
): ClaudeStreamState => {
	if (Option.isNone(sessionId) || Option.isSome(state.providerSessionId)) {
		return state
	}
	return {
		sawTextDelta: state.sawTextDelta,
		sawThinkingDelta: state.sawThinkingDelta,
		toolBlocks: state.toolBlocks,
		providerSessionId: sessionId
	}
}

const withTextDelta = (state: ClaudeStreamState): ClaudeStreamState => ({
	sawTextDelta: true,
	sawThinkingDelta: state.sawThinkingDelta,
	toolBlocks: state.toolBlocks,
	providerSessionId: state.providerSessionId
})

const withThinkingDelta = (state: ClaudeStreamState): ClaudeStreamState => ({
	sawTextDelta: state.sawTextDelta,
	sawThinkingDelta: true,
	toolBlocks: state.toolBlocks,
	providerSessionId: state.providerSessionId
})

const upsertToolBlock = (state: ClaudeStreamState, block: StreamToolBlock): ClaudeStreamState => ({
	sawTextDelta: state.sawTextDelta,
	sawThinkingDelta: state.sawThinkingDelta,
	toolBlocks: Arr.append(
		Arr.filter(state.toolBlocks, (existing) => existing.index !== block.index),
		block
	),
	providerSessionId: state.providerSessionId
})

const removeToolBlock = (state: ClaudeStreamState, index: number): ClaudeStreamState => ({
	sawTextDelta: state.sawTextDelta,
	sawThinkingDelta: state.sawThinkingDelta,
	toolBlocks: Arr.filter(state.toolBlocks, (existing) => existing.index !== index),
	providerSessionId: state.providerSessionId
})

const toolBlockAt = (state: ClaudeStreamState, index: number): Option.Option<StreamToolBlock> =>
	Arr.findFirst(state.toolBlocks, (block) => block.index === index)

const normalizeToolName = (name: string): string => {
	const trimmed = Str.trim(name)
	if (Str.startsWith("mcp__")(trimmed)) {
		return Option.getOrElse(Arr.last(Str.split(trimmed, "__")), () => trimmed)
	}
	return trimmed
}

const foldedName = (name: string): string =>
	Str.toLowerCase(Str.replaceAll(/[\s_-]/g, "")(normalizeToolName(name)))

export const detectClaudeToolKind = (name: string): ClaudeAcpToolKind => {
	const folded = foldedName(name)
	if (folded === "read" || folded === "readfile" || folded === "view" || folded === "notebookread") {
		return "read"
	}
	if (folded === "readlints") {
		return "read_lints"
	}
	if (
		folded === "bash" ||
		folded === "execute" ||
		folded === "shell" ||
		folded === "run" ||
		folded === "terminal" ||
		folded === "killshell" ||
		folded === "killbash"
	) {
		return "execute"
	}
	if (
		folded === "edit" ||
		folded === "editfile" ||
		folded === "write" ||
		folded === "writefile" ||
		folded === "multiedit" ||
		folded === "strreplace" ||
		folded === "strreplaceeditor" ||
		folded === "applypatch"
	) {
		return "edit"
	}
	if (folded === "glob" || folded === "ls") {
		return "glob"
	}
	if (folded === "grep" || folded === "search") {
		return "search"
	}
	if (folded === "webfetch" || folded === "fetch") {
		return "fetch"
	}
	if (folded === "websearch") {
		return "web_search"
	}
	if (folded === "think") {
		return "think"
	}
	if (folded === "todowrite" || folded === "todoread" || folded === "todo") {
		return "todo"
	}
	if (folded === "askuserquestion" || folded === "askuser" || folded === "question") {
		return "question"
	}
	if (folded === "task" || folded === "taskcreate" || folded === "taskupdate") {
		return "task"
	}
	if (folded === "skill") {
		return "skill"
	}
	if (folded === "enterplanmode") {
		return "enter_plan_mode"
	}
	if (folded === "exitplanmode") {
		return "exit_plan_mode"
	}
	return "other"
}

// Field names the various Claude tools use for their primary path-shaped
// input, checked in order. Mirrors the "filePath"/"file_path" duality
// CodexNativeMap.ts's extractToolFields already relies on for the same
// read/edit kinds -- Claude's own tool schemas use snake_case exclusively,
// but staying permissive costs nothing.
const PATH_INPUT_KEYS = ["file_path", "path", "notebook_path"] as const

// A short, tool-specific hint pulled from the tool's own input, used to turn
// a bare tool name ("Read") into a title that actually says what happened
// ("Read package.json") -- see toolCallTitle below. Deliberately narrow: only
// the kinds where a single input field is obviously "the point" of the call
// get a hint, everything else (todo, question, task, skill, ...) keeps its
// bare name rather than guessing at a misleading one.
const toolCallPrimaryInputHint = (
	kind: ClaudeAcpToolKind,
	rawInput: JsonObject
): Option.Option<string> => {
	if (kind === "read" || kind === "read_lints" || kind === "edit") {
		return stringFieldAny(rawInput, PATH_INPUT_KEYS)
	}
	if (kind === "execute") {
		return stringFieldAny(rawInput, ["command"])
	}
	if (kind === "search") {
		return stringFieldAny(rawInput, ["pattern", "query"])
	}
	if (kind === "glob") {
		return stringFieldAny(rawInput, ["pattern"])
	}
	if (kind === "fetch" || kind === "web_search") {
		return stringFieldAny(rawInput, ["url", "query"])
	}
	return Option.none()
}

// Mirrors CodexNativeMap.ts's extractToolFields titling convention (e.g.
// "Read /tmp/example.rs", or the bare command for execute with no tool-name
// prefix) so the same session activity row reads consistently regardless of
// which provider produced it. Falls back to the bare tool name when no hint
// is available -- e.g. content_block_start firing before the real (still
// streaming) input has arrived.
const toolCallTitle = (name: string, kind: ClaudeAcpToolKind, rawInput: JsonObject): string => {
	const hint = toolCallPrimaryInputHint(kind, rawInput)
	if (Option.isNone(hint)) {
		return name
	}
	if (kind === "execute") {
		return hint.value
	}
	return `${name} ${hint.value}`
}

// The path column of projection_session_activities -- populated only for the
// kinds that are unambiguously about a single file (read/edit), matching
// FILE_OPERATION_KINDS' intent on the projector side.
export const toolCallPathHint = (kind: ClaudeAcpToolKind, rawInput: JsonObject): Option.Option<string> => {
	if (kind !== "read" && kind !== "edit") {
		return Option.none()
	}
	return stringFieldAny(rawInput, PATH_INPUT_KEYS)
}

export const permissionIdForToolCall = (toolCallId: string): string => `perm-${toolCallId}`

export const permissionNameForToolKind = (kind: ClaudeAcpToolKind): string => {
	if (kind === "execute") {
		return "execute"
	}
	if (kind === "edit") {
		return "edit"
	}
	if (kind === "read" || kind === "read_lints") {
		return "read"
	}
	return kind
}

export const permissionRequestFact = (input: {
	readonly sessionId: string
	readonly toolCallId: string
	readonly toolName: string
}): PermissionRequestFact => ({
	contractKind: "permission_request",
	id: permissionIdForToolCall(input.toolCallId),
	sessionId: input.sessionId,
	permission: permissionNameForToolKind(detectClaudeToolKind(input.toolName)),
	toolCallId: input.toolCallId
})

const rawInputOf = (value: Json | undefined): JsonObject => {
	if (value === undefined) {
		return EMPTY_JSON_OBJECT
	}
	return Option.getOrElse(jsonObjectOf(value), () => EMPTY_JSON_OBJECT)
}

const rawInputField = (record: JsonObject, key: string): JsonObject =>
	Option.match(field(record, key), {
		onNone: () => EMPTY_JSON_OBJECT,
		onSome: (value) => rawInputOf(value)
	})

const sessionIdOf = (record: JsonObject, fallback: Option.Option<string>): Option.Option<string> =>
	Option.orElse(stringFieldAny(record, ["session_id", "sessionId"]), () => fallback)

const isHookSubtype = (subtype: string): boolean =>
	subtype === "hook_started" || subtype === "hook_progress" || subtype === "hook_response"

const promotionFacts = (
	state: ClaudeStreamState,
	sessionId: Option.Option<string>,
	durable: boolean
): ClaudeMapResult => {
	if (durable === false) {
		return { facts: Arr.empty(), state }
	}
	if (Option.isNone(sessionId) || Option.isSome(state.providerSessionId)) {
		return { facts: Arr.empty(), state: withProviderSession(state, sessionId) }
	}
	return {
		facts: [
			{
				contractKind: "provider_session",
				providerSessionId: sessionId.value
			}
		],
		state: withProviderSession(state, sessionId)
	}
}

const appendFacts = (
	left: ReadonlyArray<ClaudeContractFact>,
	right: ReadonlyArray<ClaudeContractFact>
): ReadonlyArray<ClaudeContractFact> => Arr.appendAll(left, right)

const withPreCompactionTokens = (fact: CompactionFact, value: number): CompactionFact => ({
	...fact,
	preCompactionTokens: value
})

const withPostCompactionTokens = (fact: CompactionFact, value: number): CompactionFact => ({
	...fact,
	postCompactionTokens: value
})

const withDurationMs = (fact: CompactionFact, value: number): CompactionFact => ({
	...fact,
	durationMs: value
})

const withPreservedMessageCount = (fact: CompactionFact, value: number): CompactionFact => ({
	...fact,
	preservedMessageCount: value
})

const withCumulativeDroppedTokens = (fact: CompactionFact, value: number): CompactionFact => ({
	...fact,
	cumulativeDroppedTokens: value
})

const withTimestampMs = (fact: CompactionFact, value: number): CompactionFact => ({
	...fact,
	timestampMs: value
})

const withProviderMetadata = (fact: CompactionFact, value: JsonObject): CompactionFact => ({
	...fact,
	providerMetadata: value
})

const applyOptionalNumber = (
	fact: CompactionFact,
	value: Option.Option<number>,
	apply: (current: CompactionFact, next: number) => CompactionFact
): CompactionFact =>
	Option.match(value, {
		onNone: () => fact,
		onSome: (next) => apply(fact, next)
	})

export const compactionFromRecord = (
	record: JsonObject,
	sessionId: string,
	status: ClaudeCompactionStatus,
	defaultTrigger: ClaudeCompactionTrigger
): CompactionFact => {
	const metadata = Option.getOrElse(objectField(record, "compactMetadata"), () =>
		Option.getOrElse(objectField(record, "compact_metadata"), () => record)
	)
	const eventId = Option.getOrElse(stringFieldAny(metadata, ["eventId", "event_id", "uuid"]), () =>
		Option.getOrElse(stringFieldAny(record, ["eventId", "event_id", "uuid"]), () => sessionId)
	)
	const triggerRaw = Option.getOrElse(stringFieldAny(metadata, ["trigger"]), () =>
		Option.getOrElse(stringFieldAny(record, ["trigger"]), () => defaultTrigger)
	)
	const trigger: ClaudeCompactionTrigger =
		triggerRaw === "auto" || triggerRaw === "manual" || triggerRaw === "unknown"
			? triggerRaw
			: defaultTrigger
	const statusRaw = Option.getOrUndefined(stringFieldAny(metadata, ["status"]))
	const resolvedStatus: ClaudeCompactionStatus =
		statusRaw === "preparing" ||
		statusRaw === "completed" ||
		statusRaw === "usage_reset" ||
		statusRaw === "failed"
			? statusRaw
			: status
	const base: CompactionFact = {
		contractKind: "compaction",
		eventId,
		sessionId,
		status: resolvedStatus,
		trigger
	}
	const withNumbers = applyOptionalNumber(
		applyOptionalNumber(
			applyOptionalNumber(
				applyOptionalNumber(
					applyOptionalNumber(
						applyOptionalNumber(
							base,
							numberFieldAny(metadata, ["preCompactionTokens", "pre_compaction_tokens"]),
							withPreCompactionTokens
						),
						numberFieldAny(metadata, ["postCompactionTokens", "post_compaction_tokens"]),
						withPostCompactionTokens
					),
					numberFieldAny(metadata, ["durationMs", "duration_ms"]),
					withDurationMs
				),
				numberFieldAny(metadata, ["preservedMessageCount", "preserved_message_count"]),
				withPreservedMessageCount
			),
			numberFieldAny(metadata, ["cumulativeDroppedTokens", "cumulative_dropped_tokens"]),
			withCumulativeDroppedTokens
		),
		numberFieldAny(metadata, ["timestampMs", "timestamp_ms"]),
		withTimestampMs
	)
	const providerMetadata = Option.orElse(objectField(record, "providerMetadata"), () =>
		objectField(record, "provider_metadata")
	)
	return Option.match(providerMetadata, {
		onNone: () => withNumbers,
		onSome: (value) => withProviderMetadata(withNumbers, value)
	})
}

const withUsageInput = (fact: UsageFact, value: number): UsageFact => ({
	...fact,
	inputTokens: value
})

const withUsageOutput = (fact: UsageFact, value: number): UsageFact => ({
	...fact,
	outputTokens: value
})

const withUsageTotal = (fact: UsageFact, value: number): UsageFact => ({
	...fact,
	totalTokens: value
})

const withUsageCost = (fact: UsageFact, value: number): UsageFact => ({
	...fact,
	costUsd: value
})

const withUsageWindow = (fact: UsageFact, value: number): UsageFact => ({
	...fact,
	contextWindowSize: value
})

const applyUsageNumber = (
	fact: UsageFact,
	value: Option.Option<number>,
	apply: (current: UsageFact, next: number) => UsageFact
): UsageFact =>
	Option.match(value, {
		onNone: () => fact,
		onSome: (next) => apply(fact, next)
	})

export const usageFromRecord = (record: JsonObject, sessionId: string): Option.Option<UsageFact> => {
	const usageObject = Option.getOrElse(objectField(record, "usage"), () => record)
	const inputTokens = numberFieldAny(usageObject, ["input_tokens", "inputTokens", "input"])
	const outputTokens = numberFieldAny(usageObject, ["output_tokens", "outputTokens", "output"])
	const totalTokens = Option.orElse(
		numberFieldAny(usageObject, ["total_tokens", "totalTokens", "used"]),
		() => numberFieldAny(record, ["used", "size"])
	)
	const costUsd = numberFieldAny(record, ["total_cost_usd", "costUsd", "cost_usd"])
	const contextWindowSize = numberFieldAny(record, [
		"size",
		"contextWindowSize",
		"context_window_size"
	])
	if (
		Option.isNone(inputTokens) &&
		Option.isNone(outputTokens) &&
		Option.isNone(totalTokens) &&
		Option.isNone(costUsd) &&
		Option.isNone(contextWindowSize)
	) {
		return Option.none()
	}
	const base: UsageFact = {
		contractKind: "usage",
		sessionId
	}
	return Option.some(
		applyUsageNumber(
			applyUsageNumber(
				applyUsageNumber(
					applyUsageNumber(
						applyUsageNumber(base, inputTokens, withUsageInput),
						outputTokens,
						withUsageOutput
					),
					totalTokens,
					withUsageTotal
				),
				costUsd,
				withUsageCost
			),
			contextWindowSize,
			withUsageWindow
		)
	)
}

const mapStreamEvent = (state: ClaudeStreamState, event: JsonObject): ClaudeMapResult => {
	const eventType = Option.getOrElse(stringField(event, "type"), () => "")
	if (eventType === "content_block_start") {
		const block = Option.getOrElse(objectField(event, "content_block"), () =>
			Option.getOrElse(objectField(event, "contentBlock"), () => EMPTY_JSON_OBJECT)
		)
		if (Option.getOrElse(stringField(block, "type"), () => "") !== "tool_use") {
			return { facts: Arr.empty(), state }
		}
		const id = stringField(block, "id")
		const name = stringField(block, "name")
		if (Option.isNone(id) || Option.isNone(name)) {
			return { facts: Arr.empty(), state }
		}
		const index = Option.getOrElse(numberField(event, "index"), () => 0)
		const rawInput = rawInputField(block, "input")
		const kind = detectClaudeToolKind(name.value)
		return {
			facts: [
				{
					contractKind: "tool_call",
					toolCallId: id.value,
					title: toolCallTitle(name.value, kind, rawInput),
					kind,
					status: "in_progress",
					rawInput
				}
			],
			state: upsertToolBlock(state, {
				index,
				toolCallId: id.value,
				toolName: name.value
			})
		}
	}
	if (eventType === "content_block_delta") {
		const delta = Option.getOrElse(objectField(event, "delta"), () => EMPTY_JSON_OBJECT)
		const deltaType = Option.getOrElse(stringField(delta, "type"), () => "")
		if (deltaType === "text_delta") {
			const token = stringField(delta, "text")
			if (Option.isNone(token)) {
				return { facts: Arr.empty(), state }
			}
			return {
				facts: [{ contractKind: "text_delta", token: token.value }],
				state: withTextDelta(state)
			}
		}
		if (deltaType === "thinking_delta") {
			const token = stringField(delta, "thinking")
			if (Option.isNone(token)) {
				return { facts: Arr.empty(), state }
			}
			return {
				facts: [{ contractKind: "thought_delta", token: token.value }],
				state: withThinkingDelta(state)
			}
		}
		if (deltaType === "input_json_delta") {
			const index = numberField(event, "index")
			const partialJson = stringField(delta, "partial_json")
			if (Option.isNone(index) || Option.isNone(partialJson)) {
				return { facts: Arr.empty(), state }
			}
			const block = toolBlockAt(state, index.value)
			if (Option.isNone(block)) {
				return { facts: Arr.empty(), state }
			}
			return {
				facts: [
					{
						contractKind: "tool_call_update",
						toolCallId: block.value.toolCallId,
						partialJson: partialJson.value
					}
				],
				state
			}
		}
		return { facts: Arr.empty(), state }
	}
	if (eventType === "content_block_stop") {
		const index = numberField(event, "index")
		if (Option.isNone(index)) {
			return { facts: Arr.empty(), state }
		}
		return { facts: Arr.empty(), state: removeToolBlock(state, index.value) }
	}
	return { facts: Arr.empty(), state }
}

const mapAssistantContent = (state: ClaudeStreamState, content: Json): ClaudeMapResult => {
	const record = jsonObjectOf(content)
	if (Option.isNone(record)) {
		return { facts: Arr.empty(), state }
	}
	const blockType = Option.getOrElse(stringField(record.value, "type"), () => "")
	if (blockType === "text") {
		if (state.sawTextDelta) {
			return { facts: Arr.empty(), state }
		}
		const token = stringField(record.value, "text")
		if (Option.isNone(token)) {
			return { facts: Arr.empty(), state }
		}
		return {
			facts: [{ contractKind: "text_delta", token: token.value }],
			state
		}
	}
	if (blockType === "thinking") {
		if (state.sawThinkingDelta) {
			return { facts: Arr.empty(), state }
		}
		const token = stringField(record.value, "thinking")
		if (Option.isNone(token)) {
			return { facts: Arr.empty(), state }
		}
		return {
			facts: [{ contractKind: "thought_delta", token: token.value }],
			state
		}
	}
	if (blockType === "tool_use") {
		const id = stringField(record.value, "id")
		const name = stringField(record.value, "name")
		if (Option.isNone(id) || Option.isNone(name)) {
			return { facts: Arr.empty(), state }
		}
		if (foldedName(name.value) === "exitplanmode") {
			const input = rawInputField(record.value, "input")
			const planMarkdown = stringField(input, "plan")
			if (Option.isSome(planMarkdown)) {
				return {
					facts: [
						{
							contractKind: "plan_proposal",
							planMarkdown: planMarkdown.value,
							toolCallId: id.value
						}
					],
					state
				}
			}
		}
		const rawInput = rawInputField(record.value, "input")
		const kind = detectClaudeToolKind(name.value)
		return {
			facts: [
				{
					contractKind: "tool_call",
					toolCallId: id.value,
					title: toolCallTitle(name.value, kind, rawInput),
					kind,
					status: "in_progress",
					rawInput
				}
			],
			state
		}
	}
	if (blockType === "tool_result") {
		const toolCallId = stringFieldAny(record.value, ["tool_use_id", "toolUseId"])
		if (Option.isNone(toolCallId)) {
			return { facts: Arr.empty(), state }
		}
		const isError = Option.getOrElse(booleanField(record.value, "is_error"), () => false)
		return {
			facts: [
				{
					contractKind: "tool_call_update",
					toolCallId: toolCallId.value,
					status: isError ? "failed" : "completed"
				}
			],
			state
		}
	}
	return { facts: Arr.empty(), state }
}

const mapSystem = (state: ClaudeStreamState, record: JsonObject): ClaudeMapResult => {
	const subtype = Option.getOrElse(stringField(record, "subtype"), () => "")
	const sessionId = sessionIdOf(record, state.providerSessionId)
	const durable = isHookSubtype(subtype) === false
	const promoted = promotionFacts(state, sessionId, durable)
	if (subtype === "compact_boundary" && Option.isSome(sessionId)) {
		return {
			facts: appendFacts(promoted.facts, [
				compactionFromRecord(record, sessionId.value, "completed", "auto")
			]),
			state: promoted.state
		}
	}
	if (subtype === "usage_update" && Option.isSome(sessionId)) {
		const usage = usageFromRecord(record, sessionId.value)
		const compactionReset = Option.getOrElse(booleanField(record, "compaction"), () => false)
		const usageFacts = Option.match(usage, {
			onNone: () => Arr.empty<ClaudeContractFact>(),
			onSome: (fact) => Arr.of(fact)
		})
		const resetFacts = compactionReset
			? Arr.of(compactionFromRecord(record, sessionId.value, "usage_reset", "unknown"))
			: Arr.empty<ClaudeContractFact>()
		return {
			facts: appendFacts(promoted.facts, appendFacts(usageFacts, resetFacts)),
			state: promoted.state
		}
	}
	return promoted
}

// The SDK's own type union (SDKMessage in @anthropic-ai/claude-agent-sdk)
// carries tool_result content blocks in a `user`-typed message (echoing the
// Anthropic Messages API's own shape: a tool's output is fed back to the
// model as a user-role turn), never in an `assistant`-typed one -- so the
// tool_result branch in mapAssistantContent above was DEAD for every real
// Claude turn: a tool call's start (tool_use) always arrived, but nothing
// ever closed it, exactly the second half of the live QA bug this fixes (the
// first half was ClaudeAdapter.ts folding tool facts into SessionMetaUpdated
// instead of ToolCallObserved). Deliberately narrow -- unlike
// mapAssistantContent, this does NOT touch sawTextDelta/sawThinkingDelta:
// a real tool_result user message never carries text/thinking blocks, and
// running the shared block-mapper here would let a coincidental text block
// wrongly suppress the NEXT real assistant text_delta.
const mapUserToolResultBlock = (block: Json): ReadonlyArray<ClaudeContractFact> => {
	const record = jsonObjectOf(block)
	if (Option.isNone(record)) {
		return Arr.empty()
	}
	const blockType = Option.getOrElse(stringField(record.value, "type"), () => "")
	if (blockType !== "tool_result") {
		return Arr.empty()
	}
	const toolCallId = stringFieldAny(record.value, ["tool_use_id", "toolUseId"])
	if (Option.isNone(toolCallId)) {
		return Arr.empty()
	}
	const isError = Option.getOrElse(booleanField(record.value, "is_error"), () => false)
	return [
		{
			contractKind: "tool_call_update",
			toolCallId: toolCallId.value,
			status: isError ? "failed" : "completed"
		}
	]
}

export const mapSdkMessage = (state: ClaudeStreamState, raw: Json): ClaudeMapResult => {
	const record = jsonObjectOf(raw)
	if (Option.isNone(record)) {
		return { facts: Arr.empty(), state }
	}
	const typeName = Option.getOrElse(stringField(record.value, "type"), () => "")
	if (typeName === "stream_event") {
		const sessionId = sessionIdOf(record.value, state.providerSessionId)
		const promoted = promotionFacts(state, sessionId, true)
		const event = Option.getOrElse(objectField(record.value, "event"), () => EMPTY_JSON_OBJECT)
		const mapped = mapStreamEvent(promoted.state, event)
		return {
			facts: appendFacts(promoted.facts, mapped.facts),
			state: mapped.state
		}
	}
	if (typeName === "user") {
		const sessionId = sessionIdOf(record.value, state.providerSessionId)
		const promoted = promotionFacts(state, sessionId, true)
		const message = Option.getOrElse(objectField(record.value, "message"), () => record.value)
		const content = field(message, "content")
		const blocks = Option.match(content, {
			onNone: () => Arr.empty<Json>(),
			onSome: (value) => (isJsonArray(value) ? value : Arr.empty<Json>())
		})
		const reduced = Arr.reduce(
			blocks,
			promoted.facts,
			(current, block) => appendFacts(current, mapUserToolResultBlock(block))
		)
		return {
			facts: reduced,
			state: promoted.state
		}
	}
	if (typeName === "assistant") {
		const sessionId = sessionIdOf(record.value, state.providerSessionId)
		const promoted = promotionFacts(state, sessionId, true)
		const message = Option.getOrElse(objectField(record.value, "message"), () => record.value)
		const content = field(message, "content")
		const blocks = Option.match(content, {
			onNone: () => Arr.empty<Json>(),
			onSome: (value) => (isJsonArray(value) ? value : Arr.empty<Json>())
		})
		const reduced = Arr.reduce(
			blocks,
			{ facts: promoted.facts, state: promoted.state },
			(current, block) => {
				const mapped = mapAssistantContent(current.state, block)
				return {
					facts: appendFacts(current.facts, mapped.facts),
					state: mapped.state
				}
			}
		)
		const usage = Option.flatMap(objectField(message, "usage"), (usageRecord) =>
			Option.flatMap(sessionId, (id) => usageFromRecord(usageRecord, id))
		)
		return Option.match(usage, {
			onNone: () => reduced,
			onSome: (fact) => ({
				facts: appendFacts(reduced.facts, Arr.of(fact)),
				state: reduced.state
			})
		})
	}
	if (typeName === "result") {
		const sessionId = sessionIdOf(record.value, state.providerSessionId)
		const promoted = promotionFacts(state, sessionId, true)
		const isError = Option.getOrElse(booleanField(record.value, "is_error"), () => false)
		const usage = Option.flatMap(sessionId, (id) => usageFromRecord(record.value, id))
		const usageFacts = Option.match(usage, {
			onNone: () => Arr.empty<ClaudeContractFact>(),
			onSome: (fact) => Arr.of(fact)
		})
		const terminal: ClaudeContractFact = isError
			? {
					contractKind: "turn_error",
					detail: Option.getOrElse(stringField(record.value, "result"), () => "Turn failed")
				}
			: { contractKind: "turn_complete" }
		return {
			facts: appendFacts(promoted.facts, appendFacts(usageFacts, Arr.of(terminal))),
			state: promoted.state
		}
	}
	if (typeName === "system") {
		return mapSystem(state, record.value)
	}
	return { facts: Arr.empty(), state }
}
