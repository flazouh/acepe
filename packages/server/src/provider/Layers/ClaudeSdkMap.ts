import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const EMPTY_JSON_OBJECT: JsonObject = {}

export const CLAUDE_ACP_TOOL_KINDS = [
	"read",
	"read_lints",
	"edit",
	"execute",
	"search",
	"glob",
	"fetch",
	"web_search",
	"think",
	"todo",
	"question",
	"task",
	"skill",
	"enter_plan_mode",
	"exit_plan_mode",
	"other"
] as const
export const ClaudeAcpToolKind = Schema.Literals(CLAUDE_ACP_TOOL_KINDS)
export type ClaudeAcpToolKind = typeof ClaudeAcpToolKind.Type

export const ClaudeToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"])
export type ClaudeToolStatus = typeof ClaudeToolStatus.Type

export const ClaudeCompactionStatus = Schema.Literals([
	"preparing",
	"completed",
	"usage_reset",
	"failed"
])
export type ClaudeCompactionStatus = typeof ClaudeCompactionStatus.Type

export const ClaudeCompactionTrigger = Schema.Literals(["auto", "manual", "unknown"])
export type ClaudeCompactionTrigger = typeof ClaudeCompactionTrigger.Type

export const TextDeltaFact = Schema.Struct({
	contractKind: Schema.Literal("text_delta"),
	token: Schema.String.check(Schema.isNonEmpty())
})
export type TextDeltaFact = typeof TextDeltaFact.Type

export const ThoughtDeltaFact = Schema.Struct({
	contractKind: Schema.Literal("thought_delta"),
	token: Schema.String.check(Schema.isNonEmpty())
})
export type ThoughtDeltaFact = typeof ThoughtDeltaFact.Type

export const ToolCallFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	title: Schema.String.check(Schema.isNonEmpty()),
	kind: ClaudeAcpToolKind,
	status: ClaudeToolStatus,
	rawInput: Schema.JsonObject
})
export type ToolCallFact = typeof ToolCallFact.Type

export const ToolCallUpdateFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call_update"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	status: Schema.optionalKey(ClaudeToolStatus),
	partialJson: Schema.optionalKey(Schema.String)
})
export type ToolCallUpdateFact = typeof ToolCallUpdateFact.Type

export const PermissionRequestFact = Schema.Struct({
	contractKind: Schema.Literal("permission_request"),
	id: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	permission: Schema.String.check(Schema.isNonEmpty()),
	toolCallId: Schema.String.check(Schema.isNonEmpty())
})
export type PermissionRequestFact = typeof PermissionRequestFact.Type

export const PlanProposalFact = Schema.Struct({
	contractKind: Schema.Literal("plan_proposal"),
	planMarkdown: Schema.String.check(Schema.isNonEmpty()),
	toolCallId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty()))
})
export type PlanProposalFact = typeof PlanProposalFact.Type

export const CompactionFact = Schema.Struct({
	contractKind: Schema.Literal("compaction"),
	eventId: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	status: ClaudeCompactionStatus,
	trigger: ClaudeCompactionTrigger,
	preCompactionTokens: Schema.optionalKey(Schema.Number),
	postCompactionTokens: Schema.optionalKey(Schema.Number),
	durationMs: Schema.optionalKey(Schema.Number),
	preservedMessageCount: Schema.optionalKey(Schema.Number),
	cumulativeDroppedTokens: Schema.optionalKey(Schema.Number),
	timestampMs: Schema.optionalKey(Schema.Number),
	providerMetadata: Schema.optionalKey(Schema.JsonObject)
})
export type CompactionFact = typeof CompactionFact.Type

export const UsageFact = Schema.Struct({
	contractKind: Schema.Literal("usage"),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	inputTokens: Schema.optionalKey(Schema.Number),
	outputTokens: Schema.optionalKey(Schema.Number),
	totalTokens: Schema.optionalKey(Schema.Number),
	costUsd: Schema.optionalKey(Schema.Number),
	contextWindowSize: Schema.optionalKey(Schema.Number)
})
export type UsageFact = typeof UsageFact.Type

export const DeferredOpenFact = Schema.Struct({
	contractKind: Schema.Literal("deferred_open"),
	canonicalReady: Schema.Boolean
})
export type DeferredOpenFact = typeof DeferredOpenFact.Type

export const ProviderSessionFact = Schema.Struct({
	contractKind: Schema.Literal("provider_session"),
	providerSessionId: Schema.String.check(Schema.isNonEmpty())
})
export type ProviderSessionFact = typeof ProviderSessionFact.Type

export const TurnCompleteFact = Schema.Struct({
	contractKind: Schema.Literal("turn_complete")
})
export type TurnCompleteFact = typeof TurnCompleteFact.Type

export const TurnErrorFact = Schema.Struct({
	contractKind: Schema.Literal("turn_error"),
	detail: Schema.String.check(Schema.isNonEmpty())
})
export type TurnErrorFact = typeof TurnErrorFact.Type

export const ClaudeContractFact = Schema.Union([
	TextDeltaFact,
	ThoughtDeltaFact,
	ToolCallFact,
	ToolCallUpdateFact,
	PermissionRequestFact,
	PlanProposalFact,
	CompactionFact,
	UsageFact,
	DeferredOpenFact,
	ProviderSessionFact,
	TurnCompleteFact,
	TurnErrorFact
])
export type ClaudeContractFact = typeof ClaudeContractFact.Type

const decodeFact = Schema.decodeUnknownExit(ClaudeContractFact)
const encodeFact = Schema.encodeUnknownExit(ClaudeContractFact)
const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const isJsonArray = Schema.is(Schema.Array(Schema.Json))
const decodeToolKind = Schema.decodeUnknownExit(ClaudeAcpToolKind)

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

const jsonObjectOf = (value: Json): Option.Option<JsonObject> => {
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

const stringField = (record: JsonObject, key: string): Option.Option<string> =>
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

const booleanField = (record: JsonObject, key: string): Option.Option<boolean> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isBoolean(value) ? Option.some(value) : Option.none()
	)

const objectField = (record: JsonObject, key: string): Option.Option<JsonObject> =>
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

const compactionFromRecord = (
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

const usageFromRecord = (record: JsonObject, sessionId: string): Option.Option<UsageFact> => {
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
		return {
			facts: [
				{
					contractKind: "tool_call",
					toolCallId: id.value,
					title: name.value,
					kind: detectClaudeToolKind(name.value),
					status: "in_progress",
					rawInput: rawInputField(block, "input")
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
		return {
			facts: [
				{
					contractKind: "tool_call",
					toolCallId: id.value,
					title: name.value,
					kind: detectClaudeToolKind(name.value),
					status: "in_progress",
					rawInput: rawInputField(record.value, "input")
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

export const planProposalFact = (input: {
	readonly planMarkdown: string
	readonly toolCallId: string
}): PlanProposalFact => ({
	contractKind: "plan_proposal",
	planMarkdown: input.planMarkdown,
	toolCallId: input.toolCallId
})

export const deferredOpenFact: DeferredOpenFact = {
	contractKind: "deferred_open",
	canonicalReady: false
}

export const encodeContractFact = (fact: ClaudeContractFact): Option.Option<JsonObject> => {
	const encoded = encodeFact(fact)
	if (Exit.isFailure(encoded)) {
		return Option.none()
	}
	return jsonObjectOf(encoded.value)
}

export const decodeContractFact = (value: Json): Option.Option<ClaudeContractFact> => {
	const decoded = decodeFact(value)
	if (Exit.isFailure(decoded)) {
		return Option.none()
	}
	return Option.some(decoded.value)
}

const withAcpPre = (event: JsonObject, value: number): JsonObject => ({
	...event,
	preCompactionTokens: value
})

const withAcpPost = (event: JsonObject, value: number): JsonObject => ({
	...event,
	postCompactionTokens: value
})

const withAcpDuration = (event: JsonObject, value: number): JsonObject => ({
	...event,
	durationMs: value
})

const withAcpPreserved = (event: JsonObject, value: number): JsonObject => ({
	...event,
	preservedMessageCount: value
})

const withAcpDropped = (event: JsonObject, value: number): JsonObject => ({
	...event,
	cumulativeDroppedTokens: value
})

const withAcpTimestamp = (event: JsonObject, value: number): JsonObject => ({
	...event,
	timestampMs: value
})

const withAcpProviderMetadata = (event: JsonObject, value: JsonObject): JsonObject => ({
	...event,
	providerMetadata: value
})

const applyAcpNumber = (
	event: JsonObject,
	value: number | undefined,
	apply: (current: JsonObject, next: number) => JsonObject
): JsonObject => {
	if (value === undefined) {
		return event
	}
	return apply(event, value)
}

export const contractFactToAcpSessionUpdate = (fact: ClaudeContractFact): JsonObject => {
	if (fact.contractKind === "tool_call") {
		return {
			type: "tool_call",
			toolCallId: fact.toolCallId,
			title: fact.title,
			kind: fact.kind,
			status: fact.status,
			rawInput: fact.rawInput
		}
	}
	if (fact.contractKind === "permission_request") {
		return {
			type: "permissionRequest",
			permissionRequest: {
				id: fact.id,
				sessionId: fact.sessionId,
				permission: fact.permission,
				toolCallId: fact.toolCallId
			}
		}
	}
	if (fact.contractKind === "compaction") {
		const base: JsonObject = {
			eventId: fact.eventId,
			sessionId: fact.sessionId,
			status: fact.status,
			trigger: fact.trigger
		}
		const withNumbers = applyAcpNumber(
			applyAcpNumber(
				applyAcpNumber(
					applyAcpNumber(
						applyAcpNumber(
							applyAcpNumber(base, fact.preCompactionTokens, withAcpPre),
							fact.postCompactionTokens,
							withAcpPost
						),
						fact.durationMs,
						withAcpDuration
					),
					fact.preservedMessageCount,
					withAcpPreserved
				),
				fact.cumulativeDroppedTokens,
				withAcpDropped
			),
			fact.timestampMs,
			withAcpTimestamp
		)
		const event = Option.match(Option.fromNullishOr(fact.providerMetadata), {
			onNone: () => withNumbers,
			onSome: (value) => withAcpProviderMetadata(withNumbers, value)
		})
		return {
			type: "compactionEvent",
			event
		}
	}
	if (fact.contractKind === "text_delta") {
		return { type: "agent_message_chunk", token: fact.token }
	}
	if (fact.contractKind === "thought_delta") {
		return { type: "agent_thought_chunk", token: fact.token }
	}
	if (fact.contractKind === "tool_call_update") {
		if (fact.status === undefined) {
			if (fact.partialJson === undefined) {
				return {
					type: "tool_call_update",
					toolCallId: fact.toolCallId
				}
			}
			return {
				type: "tool_call_update",
				toolCallId: fact.toolCallId,
				partialJson: fact.partialJson
			}
		}
		if (fact.partialJson === undefined) {
			return {
				type: "tool_call_update",
				toolCallId: fact.toolCallId,
				status: fact.status
			}
		}
		return {
			type: "tool_call_update",
			toolCallId: fact.toolCallId,
			status: fact.status,
			partialJson: fact.partialJson
		}
	}
	if (fact.contractKind === "plan_proposal") {
		if (fact.toolCallId === undefined) {
			return {
				type: "plan_proposal",
				planMarkdown: fact.planMarkdown
			}
		}
		return {
			type: "plan_proposal",
			planMarkdown: fact.planMarkdown,
			toolCallId: fact.toolCallId
		}
	}
	if (fact.contractKind === "usage") {
		const base: JsonObject = {
			type: "usage",
			sessionId: fact.sessionId
		}
		return applyAcpNumber(
			applyAcpNumber(
				applyAcpNumber(
					applyAcpNumber(
						applyAcpNumber(base, fact.inputTokens, (current, value) => ({
							...current,
							inputTokens: value
						})),
						fact.outputTokens,
						(current, value) => ({
							...current,
							outputTokens: value
						})
					),
					fact.totalTokens,
					(current, value) => ({
						...current,
						totalTokens: value
					})
				),
				fact.costUsd,
				(current, value) => ({
					...current,
					costUsd: value
				})
			),
			fact.contextWindowSize,
			(current, value) => ({
				...current,
				contextWindowSize: value
			})
		)
	}
	if (fact.contractKind === "deferred_open") {
		return { type: "deferred_open", canonicalReady: fact.canonicalReady }
	}
	if (fact.contractKind === "provider_session") {
		return { type: "provider_session", providerSessionId: fact.providerSessionId }
	}
	if (fact.contractKind === "turn_complete") {
		return { type: "turn_complete" }
	}
	return { type: "turn_error", detail: fact.detail }
}

const asToolStatus = (value: string): Option.Option<ClaudeToolStatus> => {
	if (value === "pending" || value === "in_progress" || value === "completed" || value === "failed") {
		return Option.some(value)
	}
	return Option.none()
}

const asToolKind = (value: string): ClaudeAcpToolKind => {
	const decoded = decodeToolKind(value)
	if (Exit.isSuccess(decoded)) {
		return decoded.value
	}
	return detectClaudeToolKind(value)
}

const asCompactionStatus = (value: string): ClaudeCompactionStatus => {
	if (
		value === "preparing" ||
		value === "completed" ||
		value === "usage_reset" ||
		value === "failed"
	) {
		return value
	}
	return "completed"
}

const asCompactionTrigger = (value: string): ClaudeCompactionTrigger => {
	if (value === "auto" || value === "manual" || value === "unknown") {
		return value
	}
	return "unknown"
}

export const acpSessionUpdateToFact = (payload: Json): Option.Option<ClaudeContractFact> => {
	const record = jsonObjectOf(payload)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const typeName = Option.getOrElse(stringField(record.value, "type"), () => "")
	if (typeName === "tool_call") {
		const toolCallId = stringField(record.value, "toolCallId")
		const title = stringField(record.value, "title")
		const kind = stringField(record.value, "kind")
		const status = Option.flatMap(stringField(record.value, "status"), asToolStatus)
		const rawInput = Option.getOrElse(objectField(record.value, "rawInput"), () => EMPTY_JSON_OBJECT)
		if (Option.isNone(toolCallId) || Option.isNone(title) || Option.isNone(status)) {
			return Option.none()
		}
		return Option.some({
			contractKind: "tool_call",
			toolCallId: toolCallId.value,
			title: title.value,
			kind: asToolKind(Option.getOrElse(kind, () => title.value)),
			status: status.value,
			rawInput
		})
	}
	if (typeName === "permissionRequest") {
		const nested = objectField(record.value, "permissionRequest")
		if (Option.isNone(nested)) {
			return Option.none()
		}
		const id = stringField(nested.value, "id")
		const sessionId = stringField(nested.value, "sessionId")
		const permission = stringField(nested.value, "permission")
		const toolCallId = stringField(nested.value, "toolCallId")
		if (
			Option.isNone(id) ||
			Option.isNone(sessionId) ||
			Option.isNone(permission) ||
			Option.isNone(toolCallId)
		) {
			return Option.none()
		}
		return Option.some({
			contractKind: "permission_request",
			id: id.value,
			sessionId: sessionId.value,
			permission: permission.value,
			toolCallId: toolCallId.value
		})
	}
	if (typeName === "compactionEvent") {
		const event = objectField(record.value, "event")
		if (Option.isNone(event)) {
			return Option.none()
		}
		const eventId = stringField(event.value, "eventId")
		const sessionId = stringField(event.value, "sessionId")
		const status = stringField(event.value, "status")
		const trigger = stringField(event.value, "trigger")
		if (
			Option.isNone(eventId) ||
			Option.isNone(sessionId) ||
			Option.isNone(status) ||
			Option.isNone(trigger)
		) {
			return Option.none()
		}
		return Option.some(
			compactionFromRecord(
				event.value,
				sessionId.value,
				asCompactionStatus(status.value),
				asCompactionTrigger(trigger.value)
			)
		)
	}
	if (typeName === "agent_message_chunk") {
		const token = stringField(record.value, "token")
		if (Option.isNone(token)) {
			return Option.none()
		}
		return Option.some({ contractKind: "text_delta", token: token.value })
	}
	if (typeName === "agent_thought_chunk") {
		const token = stringField(record.value, "token")
		if (Option.isNone(token)) {
			return Option.none()
		}
		return Option.some({ contractKind: "thought_delta", token: token.value })
	}
	if (typeName === "tool_call_update") {
		const toolCallId = stringField(record.value, "toolCallId")
		if (Option.isNone(toolCallId)) {
			return Option.none()
		}
		const status = Option.flatMap(stringField(record.value, "status"), asToolStatus)
		const partialJson = Option.getOrUndefined(stringField(record.value, "partialJson"))
		if (Option.isNone(status)) {
			if (partialJson === undefined) {
				return Option.some({
					contractKind: "tool_call_update",
					toolCallId: toolCallId.value
				})
			}
			return Option.some({
				contractKind: "tool_call_update",
				toolCallId: toolCallId.value,
				partialJson
			})
		}
		if (partialJson === undefined) {
			return Option.some({
				contractKind: "tool_call_update",
				toolCallId: toolCallId.value,
				status: status.value
			})
		}
		return Option.some({
			contractKind: "tool_call_update",
			toolCallId: toolCallId.value,
			status: status.value,
			partialJson
		})
	}
	if (typeName === "plan_proposal") {
		const planMarkdown = stringField(record.value, "planMarkdown")
		if (Option.isNone(planMarkdown)) {
			return Option.none()
		}
		const toolCallId = Option.getOrUndefined(stringField(record.value, "toolCallId"))
		if (toolCallId === undefined) {
			return Option.some({
				contractKind: "plan_proposal",
				planMarkdown: planMarkdown.value
			})
		}
		return Option.some({
			contractKind: "plan_proposal",
			planMarkdown: planMarkdown.value,
			toolCallId
		})
	}
	if (typeName === "usage") {
		const sessionId = stringField(record.value, "sessionId")
		if (Option.isNone(sessionId)) {
			return Option.none()
		}
		return usageFromRecord(record.value, sessionId.value)
	}
	if (typeName === "deferred_open") {
		const canonicalReady = booleanField(record.value, "canonicalReady")
		if (Option.isNone(canonicalReady)) {
			return Option.none()
		}
		return Option.some({
			contractKind: "deferred_open",
			canonicalReady: canonicalReady.value
		})
	}
	if (typeName === "provider_session") {
		const providerSessionId = stringField(record.value, "providerSessionId")
		if (Option.isNone(providerSessionId)) {
			return Option.none()
		}
		return Option.some({
			contractKind: "provider_session",
			providerSessionId: providerSessionId.value
		})
	}
	if (typeName === "turn_complete") {
		return Option.some({ contractKind: "turn_complete" })
	}
	if (typeName === "turn_error") {
		const detail = stringField(record.value, "detail")
		if (Option.isNone(detail)) {
			return Option.none()
		}
		return Option.some({
			contractKind: "turn_error",
			detail: detail.value
		})
	}
	return Option.none()
}

export const roundTripAcpSessionUpdate = (payload: Json): Option.Option<JsonObject> =>
	Option.map(acpSessionUpdateToFact(payload), contractFactToAcpSessionUpdate)

export const isTurnTerminalFact = (fact: ClaudeContractFact): boolean =>
	fact.contractKind === "turn_complete" || fact.contractKind === "turn_error"
