import * as Arr from "effect/Array"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Str from "effect/String"
import {
	applyOptional,
	booleanField,
	EMPTY_JSON_OBJECT,
	field,
	isJsonArray,
	type Json,
	type JsonObject,
	jsonObjectOf,
	numberField,
	numberFieldAny,
	objectField,
	stringField,
	stringFieldAny
} from "../Json.ts"
import {
	type ClaudeCompactionStatus,
	type ClaudeCompactionTrigger,
	type ClaudeContractFact,
	type CompactionFact,
	type PermissionRequestFact,
	type ToolCallUpdateFact,
	type UsageFact
} from "./Facts.ts"
import {
	detectClaudeToolKind,
	foldedName,
	permissionIdForToolCall,
	permissionNameForToolKind,
	toolCallTitle
} from "./Tools.ts"

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

// One text block of a tool_result's content array. A tool can also answer
// with an image block, which a transcript row has no text to show for.
const toolResultBlockText = (entry: Json): Option.Option<string> =>
	Option.flatMap(jsonObjectOf(entry), (record) => stringField(record, "text"))

// A tool_result block's content is the result the tool produced. The SDK
// sends it either as a bare string or as the Messages API's own block array
// (text blocks, sometimes an image block a transcript row cannot show), so
// both shapes collapse to the same text here. Blank is absent, like every
// other field this map reads.
const toolResultText = (record: JsonObject): Option.Option<string> => {
	const content = field(record, "content")
	if (Option.isNone(content)) {
		return Option.none()
	}
	if (typeof content.value === "string") {
		const trimmed = Str.trim(content.value)
		return Str.isNonEmpty(trimmed) ? Option.some(trimmed) : Option.none()
	}
	if (isJsonArray(content.value) === false) {
		return Option.none()
	}
	const texts = Arr.filterMap(content.value, Filter.fromPredicateOption(toolResultBlockText))
	if (Arr.isReadonlyArrayNonEmpty(texts) === false) {
		return Option.none()
	}
	const joined = Str.trim(Arr.join(texts, "\n"))
	return Str.isNonEmpty(joined) ? Option.some(joined) : Option.none()
}

// The one place a tool_result block becomes a fact, shared by the assistant
// and the user block mappers below so a result cannot be read on one path and
// dropped on the other.
const toolResultUpdateFact = (record: JsonObject): Option.Option<ToolCallUpdateFact> => {
	const toolCallId = stringFieldAny(record, ["tool_use_id", "toolUseId"])
	if (Option.isNone(toolCallId)) {
		return Option.none()
	}
	const isError = Option.getOrElse(booleanField(record, "is_error"), () => false)
	const base: ToolCallUpdateFact = {
		contractKind: "tool_call_update",
		toolCallId: toolCallId.value,
		status: isError ? "failed" : "completed"
	}
	return Option.some(
		Option.match(toolResultText(record), {
			onNone: () => base,
			onSome: (output) => ({ ...base, output })
		})
	)
}

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

const applyOptionalNumber = <A>(
	fact: A,
	value: Option.Option<number>,
	apply: (current: A, next: number) => A
): A => applyOptional(fact, Option.getOrUndefined(value), apply)

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
		applyOptionalNumber(
			applyOptionalNumber(
				applyOptionalNumber(
					applyOptionalNumber(
						applyOptionalNumber(base, inputTokens, withUsageInput),
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
		return {
			facts: Option.match(toolResultUpdateFact(record.value), {
				onNone: () => Arr.empty<ClaudeContractFact>(),
				onSome: (fact) => Arr.of<ClaudeContractFact>(fact)
			}),
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
// first half was Session.ts folding tool facts into SessionMetaUpdated
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
	return Option.match(toolResultUpdateFact(record.value), {
		onNone: () => Arr.empty<ClaudeContractFact>(),
		onSome: (fact) => Arr.of<ClaudeContractFact>(fact)
	})
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
