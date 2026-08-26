import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const EMPTY_JSON_OBJECT: JsonObject = {}
const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)

export const CODEX_ACP_TOOL_KINDS = [
	"read",
	"edit",
	"execute",
	"search",
	"other"
] as const
export const CodexAcpToolKind = Schema.Literals(CODEX_ACP_TOOL_KINDS)
export type CodexAcpToolKind = typeof CodexAcpToolKind.Type

export const CodexToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"])
export type CodexToolStatus = typeof CodexToolStatus.Type

export const TextDeltaFact = Schema.Struct({
	contractKind: Schema.Literal("text_delta"),
	token: Schema.String.check(Schema.isNonEmpty()),
	aggregationHint: Schema.optionalKey(Schema.Literal("boundary_carryover"))
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
	kind: CodexAcpToolKind,
	status: CodexToolStatus,
	rawInput: Schema.JsonObject
})
export type ToolCallFact = typeof ToolCallFact.Type

export const ToolCallUpdateFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call_update"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	status: CodexToolStatus,
	title: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	result: Schema.optionalKey(Schema.Json)
})
export type ToolCallUpdateFact = typeof ToolCallUpdateFact.Type

export const PermissionRequestFact = Schema.Struct({
	contractKind: Schema.Literal("permission_request"),
	id: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	permission: Schema.String.check(Schema.isNonEmpty()),
	toolCallId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	always: Schema.Array(Schema.String)
})
export type PermissionRequestFact = typeof PermissionRequestFact.Type

export const QuestionOption = Schema.Struct({
	label: Schema.String.check(Schema.isNonEmpty()),
	description: Schema.String.check(Schema.isNonEmpty())
})
export type QuestionOption = typeof QuestionOption.Type

export const QuestionItem = Schema.Struct({
	id: Schema.String.check(Schema.isNonEmpty()),
	header: Schema.String.check(Schema.isNonEmpty()),
	question: Schema.String.check(Schema.isNonEmpty()),
	multiSelect: Schema.Boolean,
	options: Schema.Array(QuestionOption)
})
export type QuestionItem = typeof QuestionItem.Type

export const QuestionRequestFact = Schema.Struct({
	contractKind: Schema.Literal("question_request"),
	id: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	toolCallId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	questions: Schema.Array(QuestionItem)
})
export type QuestionRequestFact = typeof QuestionRequestFact.Type

export const PlanProposalFact = Schema.Struct({
	contractKind: Schema.Literal("plan_proposal"),
	planMarkdown: Schema.String,
	streaming: Schema.Boolean
})
export type PlanProposalFact = typeof PlanProposalFact.Type

export const UsageFact = Schema.Struct({
	contractKind: Schema.Literal("usage"),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	eventId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	inputTokens: Schema.optionalKey(Schema.Number),
	outputTokens: Schema.optionalKey(Schema.Number),
	totalTokens: Schema.optionalKey(Schema.Number),
	cacheReadTokens: Schema.optionalKey(Schema.Number),
	cacheWriteTokens: Schema.optionalKey(Schema.Number),
	reasoningTokens: Schema.optionalKey(Schema.Number),
	contextWindowSize: Schema.optionalKey(Schema.Number)
})
export type UsageFact = typeof UsageFact.Type

export const ProviderSessionFact = Schema.Struct({
	contractKind: Schema.Literal("provider_session"),
	providerSessionId: Schema.String.check(Schema.isNonEmpty())
})
export type ProviderSessionFact = typeof ProviderSessionFact.Type

export const TurnCompleteFact = Schema.Struct({
	contractKind: Schema.Literal("turn_complete"),
	turnId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty()))
})
export type TurnCompleteFact = typeof TurnCompleteFact.Type

export const TurnErrorFact = Schema.Struct({
	contractKind: Schema.Literal("turn_error"),
	detail: Schema.String.check(Schema.isNonEmpty()),
	turnId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty()))
})
export type TurnErrorFact = typeof TurnErrorFact.Type

export const CodexContractFact = Schema.Union([
	TextDeltaFact,
	ThoughtDeltaFact,
	ToolCallFact,
	ToolCallUpdateFact,
	PermissionRequestFact,
	QuestionRequestFact,
	PlanProposalFact,
	UsageFact,
	ProviderSessionFact,
	TurnCompleteFact,
	TurnErrorFact
])
export type CodexContractFact = typeof CodexContractFact.Type

const decodeFact = Schema.decodeUnknownExit(CodexContractFact)
const encodeFact = Schema.encodeUnknownExit(CodexContractFact)

const COMMAND_APPROVAL_METHOD = "item/commandExecution/requestApproval"
const FILE_READ_APPROVAL_METHOD = "item/fileRead/requestApproval"
const FILE_CHANGE_APPROVAL_METHOD = "item/fileChange/requestApproval"
const USER_INPUT_REQUEST_METHOD = "item/tool/requestUserInput"
const AGENT_MESSAGE_DELTA_METHOD = "item/agentMessage/delta"
const REASONING_TEXT_DELTA_METHOD = "item/reasoning/textDelta"
const REASONING_SUMMARY_DELTA_METHOD = "item/reasoning/summaryTextDelta"
const TURN_COMPLETED_METHOD = "turn/completed"
const ERROR_METHOD = "error"
const ITEM_STARTED_METHOD = "item/started"
const ITEM_COMPLETED_METHOD = "item/completed"
const TOKEN_USAGE_UPDATED_METHOD = "thread/tokenUsage/updated"
const ACCOUNT_RATE_LIMITS_UPDATED_METHOD = "account/rateLimits/updated"
const PLAN_OPEN_TAG = "<proposed_plan>"
const PLAN_CLOSE_TAG = "</proposed_plan>"

export type CodexPlanTagState = {
	readonly pending: string
	readonly capturing: boolean
	readonly capturedContent: string
}

export const emptyCodexPlanTagState: CodexPlanTagState = {
	pending: "",
	capturing: false,
	capturedContent: ""
}

export type CodexMapState = {
	readonly plan: CodexPlanTagState
}

export const emptyCodexMapState: CodexMapState = {
	plan: emptyCodexPlanTagState
}

export type CodexMapResult = {
	readonly facts: ReadonlyArray<CodexContractFact>
	readonly state: CodexMapState
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

const rawStringField = (record: JsonObject, key: string): Option.Option<string> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isString(value) && Str.isNonEmpty(value) ? Option.some(value) : Option.none()
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

const objectFieldAny = (record: JsonObject, keys: ReadonlyArray<string>): Option.Option<JsonObject> =>
	Arr.reduce(keys, Option.none<JsonObject>(), (found, key) =>
		Option.isSome(found) ? found : objectField(record, key)
	)

const isJsonArray = Schema.is(Schema.Array(Schema.Json))

const stringifyJsonRpcId = (value: Option.Option<Json>): Option.Option<string> =>
	Option.flatMap(value, (id) => {
		if (Predicate.isString(id) && Str.isNonEmpty(Str.trim(id))) {
			return Option.some(id)
		}
		if (Predicate.isNumber(id)) {
			return Option.some(String(id))
		}
		return Option.none()
	})

const isBoundaryChar = (ch: string): boolean =>
	ch === " " ||
	ch === "\n" ||
	ch === "\t" ||
	ch === "\r" ||
	ch === "." ||
	ch === "," ||
	ch === "!" ||
	ch === "?" ||
	ch === ";" ||
	ch === ":" ||
	ch === ")" ||
	ch === "]" ||
	ch === "}" ||
	ch === ">" ||
	ch === '"' ||
	ch === "'" ||
	ch === "`" ||
	ch === "-"

export const classifyChunkAggregationHint = (
	text: string
): Option.Option<"boundary_carryover"> => {
	if (Str.isEmpty(Str.trim(text))) {
		return Option.none()
	}
	if (Arr.every(Arr.fromIterable(text), isBoundaryChar)) {
		return Option.some("boundary_carryover")
	}
	return Option.none()
}

const isToolItemType = (itemType: string): boolean =>
	itemType === "commandExecution" ||
	itemType === "fileRead" ||
	itemType === "fileChange" ||
	itemType === "fileSearch" ||
	itemType === "codeEdit"

const firstCommandAction = (item: JsonObject): Option.Option<string> => {
	const actions = field(item, "commandActions")
	if (Option.isNone(actions) || isJsonArray(actions.value) === false) {
		return Option.none()
	}
	const first = Arr.head(actions.value)
	return Option.flatMap(first, (entry) =>
		Option.flatMap(jsonObjectOf(entry), (action) => stringField(action, "command"))
	)
}

const extractToolFields = (
	itemType: string,
	item: JsonObject
): { readonly name: string; readonly kind: CodexAcpToolKind; readonly title: string; readonly rawInput: JsonObject } => {
	if (itemType === "commandExecution") {
		const command = Option.getOrElse(firstCommandAction(item), () =>
			Option.getOrElse(stringField(item, "command"), () => "")
		)
		return {
			name: "Execute",
			kind: "execute",
			title: Str.isNonEmpty(command) ? command : "Execute",
			rawInput: { command }
		}
	}
	if (itemType === "fileRead") {
		const filePath = Option.getOrElse(stringFieldAny(item, ["filePath", "path"]), () => "")
		return {
			name: "Read",
			kind: "read",
			title: Str.isNonEmpty(filePath) ? `Read ${filePath}` : "Read",
			rawInput: { filePath }
		}
	}
	if (itemType === "fileChange") {
		const filePath = Option.getOrElse(stringFieldAny(item, ["filePath", "path"]), () => "")
		return {
			name: "Edit",
			kind: "edit",
			title: Str.isNonEmpty(filePath) ? `Edit ${filePath}` : "Edit",
			rawInput: { filePath }
		}
	}
	const label = Option.getOrElse(stringFieldAny(item, ["title", "name"]), () => itemType)
	return {
		name: itemType,
		kind: "other",
		title: label,
		rawInput: item
	}
}

const toolStatusFromItem = (item: JsonObject, completed: boolean): CodexToolStatus => {
	const status = Option.getOrElse(stringField(item, "status"), () => "")
	if (status === "failed") {
		return "failed"
	}
	if (completed) {
		return "completed"
	}
	if (status === "completed") {
		return "completed"
	}
	return "in_progress"
}

const toolResult = (item: JsonObject): Option.Option<Json> => {
	const aggregated = field(item, "aggregatedOutput")
	if (Option.isSome(aggregated) && aggregated.value !== null) {
		return Option.some(aggregated.value)
	}
	const exitCode = field(item, "exitCode")
	if (Option.isSome(exitCode) && exitCode.value !== null) {
		return Option.some({ exitCode: exitCode.value })
	}
	return Option.none()
}

const extractTurnId = (params: JsonObject): Option.Option<string> => {
	const direct = stringFieldAny(params, ["turnId", "turn_id"])
	if (Option.isSome(direct)) {
		return direct
	}
	return Option.flatMap(objectField(params, "turn"), (turn) => stringField(turn, "id"))
}

const permissionLabel = (method: string, params: JsonObject): string => {
	if (method === COMMAND_APPROVAL_METHOD) {
		return Option.getOrElse(stringField(params, "command"), () => "CommandExecution")
	}
	if (method === FILE_READ_APPROVAL_METHOD) {
		const path = stringFieldAny(params, ["filePath", "path"])
		return Option.match(path, {
			onNone: () => "Read",
			onSome: (value) => `Read ${value}`
		})
	}
	if (method === FILE_CHANGE_APPROVAL_METHOD) {
		const path = stringFieldAny(params, ["filePath", "path"])
		return Option.match(path, {
			onNone: () => "Edit",
			onSome: (value) => `Edit ${value}`
		})
	}
	return "Permission"
}

const parseQuestionOptions = (question: JsonObject): ReadonlyArray<QuestionOption> => {
	const raw = field(question, "options")
	if (Option.isNone(raw) || isJsonArray(raw.value) === false) {
		return Arr.empty()
	}
	return Arr.filterMap(
		raw.value,
		Filter.fromPredicateOption((entry) => {
			const option = jsonObjectOf(entry)
			if (Option.isNone(option)) {
				return Option.none()
			}
			const label = stringField(option.value, "label")
			const description = stringField(option.value, "description")
			if (Option.isNone(label) || Option.isNone(description)) {
				return Option.none()
			}
			return Option.some({
				label: label.value,
				description: description.value
			})
		})
	)
}

const parseQuestions = (params: JsonObject): ReadonlyArray<QuestionItem> => {
	const raw = field(params, "questions")
	if (Option.isNone(raw) || isJsonArray(raw.value) === false) {
		return Arr.empty()
	}
	return Arr.filterMap(
		raw.value,
		Filter.fromPredicateOption((entry) => {
			const question = jsonObjectOf(entry)
			if (Option.isNone(question)) {
				return Option.none()
			}
			const header = stringField(question.value, "header")
			const prompt = stringField(question.value, "question")
			const id = stringField(question.value, "id")
			const options = parseQuestionOptions(question.value)
			if (Option.isNone(header) || Option.isNone(prompt) || options.length === 0) {
				return Option.none()
			}
			return Option.some({
				id: Option.getOrElse(id, () => "codex-user-input"),
				header: header.value,
				question: prompt.value,
				multiSelect: Option.getOrElse(booleanField(question.value, "multiSelect"), () => false),
				options
			})
		})
	)
}

const hasTokenCountFields = (object: JsonObject): boolean =>
	Option.isSome(
		numberFieldAny(object, [
			"totalTokens",
			"total_tokens",
			"inputTokens",
			"input_tokens",
			"outputTokens",
			"output_tokens",
			"cachedInputTokens",
			"cached_input_tokens",
			"reasoningOutputTokens",
			"reasoning_output_tokens"
		])
	)

const selectTokenCountsObject = (object: JsonObject): Option.Option<JsonObject> => {
	if (hasTokenCountFields(object)) {
		return Option.some(object)
	}
	const nestedKeys = [
		"last",
		"total",
		"lastTokenUsage",
		"last_token_usage",
		"totalTokenUsage",
		"total_token_usage",
		"tokenUsage",
		"token_usage"
	]
	return Arr.reduce(nestedKeys, Option.none<JsonObject>(), (found, key) => {
		if (Option.isSome(found)) {
			return found
		}
		const candidate = objectField(object, key)
		if (Option.isSome(candidate) && hasTokenCountFields(candidate.value)) {
			return candidate
		}
		return Option.none()
	})
}

const formatOptionalNumber = (value: Option.Option<number>): string =>
	Option.match(value, {
		onNone: () => "none",
		onSome: (number) => String(number)
	})

const withUsageNumber = (
	fact: UsageFact,
	value: Option.Option<number>,
	key: "inputTokens" | "outputTokens" | "totalTokens" | "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens" | "contextWindowSize"
): UsageFact =>
	Option.match(value, {
		onNone: () => fact,
		onSome: (next) => {
			if (key === "inputTokens") {
				return { ...fact, inputTokens: next }
			}
			if (key === "outputTokens") {
				return { ...fact, outputTokens: next }
			}
			if (key === "totalTokens") {
				return { ...fact, totalTokens: next }
			}
			if (key === "cacheReadTokens") {
				return { ...fact, cacheReadTokens: next }
			}
			if (key === "cacheWriteTokens") {
				return { ...fact, cacheWriteTokens: next }
			}
			if (key === "reasoningTokens") {
				return { ...fact, reasoningTokens: next }
			}
			return { ...fact, contextWindowSize: next }
		}
	})

const translateTokenUsage = (sessionId: string, params: JsonObject): Option.Option<UsageFact> => {
	const tokenUsageOption = objectFieldAny(params, ["tokenUsage", "token_usage"])
	if (Option.isNone(tokenUsageOption)) {
		return Option.none()
	}
	const tokenUsage = tokenUsageOption.value
	const sourceObject = Option.getOrElse(objectField(tokenUsage, "info"), () => tokenUsage)
	const usageObject = Option.orElse(selectTokenCountsObject(sourceObject), () =>
		selectTokenCountsObject(tokenUsage)
	)
	const contextWindowSize = Option.orElse(
		numberFieldAny(tokenUsage, [
			"modelContextWindow",
			"model_context_window",
			"contextWindowSize",
			"context_window_size",
			"contextWindow",
			"context_window",
			"size"
		]),
		() =>
			numberFieldAny(sourceObject, [
				"modelContextWindow",
				"model_context_window",
				"contextWindowSize",
				"context_window_size",
				"contextWindow",
				"context_window",
				"size"
			])
	)
	const inputTokens = Option.flatMap(usageObject, (usage) =>
		numberFieldAny(usage, ["inputTokens", "input_tokens"])
	)
	const outputTokens = Option.flatMap(usageObject, (usage) =>
		numberFieldAny(usage, ["outputTokens", "output_tokens"])
	)
	const totalTokens = Option.flatMap(usageObject, (usage) =>
		numberFieldAny(usage, ["totalTokens", "total_tokens"])
	)
	const cacheReadTokens = Option.flatMap(usageObject, (usage) =>
		numberFieldAny(usage, [
			"cachedInputTokens",
			"cached_input_tokens",
			"cacheReadInputTokens",
			"cache_read_input_tokens"
		])
	)
	const cacheWriteTokens = Option.flatMap(usageObject, (usage) =>
		numberFieldAny(usage, [
			"cacheCreationInputTokens",
			"cache_creation_input_tokens",
			"cacheWriteInputTokens",
			"cache_write_input_tokens"
		])
	)
	const reasoningTokens = Option.flatMap(usageObject, (usage) =>
		numberFieldAny(usage, [
			"reasoningOutputTokens",
			"reasoning_output_tokens",
			"reasoningTokens",
			"reasoning_tokens"
		])
	)
	if (
		Option.isNone(usageObject) &&
		Option.isNone(contextWindowSize)
	) {
		return Option.none()
	}
	if (
		Option.isNone(inputTokens) &&
		Option.isNone(outputTokens) &&
		Option.isNone(totalTokens) &&
		Option.isNone(cacheReadTokens) &&
		Option.isNone(cacheWriteTokens) &&
		Option.isNone(reasoningTokens) &&
		Option.isNone(contextWindowSize)
	) {
		return Option.none()
	}
	const threadId = Option.getOrElse(stringFieldAny(params, ["threadId", "thread_id"]), () => "thread")
	const turnId = Option.getOrElse(stringFieldAny(params, ["turnId", "turn_id"]), () => "turn")
	const eventId = `codex-token-usage:${threadId}:${turnId}:total=${formatOptionalNumber(totalTokens)}:input=${formatOptionalNumber(inputTokens)}:output=${formatOptionalNumber(outputTokens)}:cache-read=${formatOptionalNumber(cacheReadTokens)}:cache-write=${formatOptionalNumber(cacheWriteTokens)}:reasoning=${formatOptionalNumber(reasoningTokens)}:context=${formatOptionalNumber(contextWindowSize)}`
	const base: UsageFact = {
		contractKind: "usage",
		sessionId,
		eventId
	}
	return Option.some(
		withUsageNumber(
			withUsageNumber(
				withUsageNumber(
					withUsageNumber(
						withUsageNumber(
							withUsageNumber(
								withUsageNumber(base, inputTokens, "inputTokens"),
								outputTokens,
								"outputTokens"
							),
							totalTokens,
							"totalTokens"
						),
						cacheReadTokens,
						"cacheReadTokens"
					),
					cacheWriteTokens,
					"cacheWriteTokens"
				),
				reasoningTokens,
				"reasoningTokens"
			),
			contextWindowSize,
			"contextWindowSize"
		)
	)
}

const processPlanChunk = (
	state: CodexPlanTagState,
	textDelta: string
): { readonly plan: Option.Option<PlanProposalFact>; readonly state: CodexPlanTagState } => {
	if (Str.isEmpty(textDelta)) {
		return { plan: Option.none(), state }
	}
	const buffer = `${state.pending}${textDelta}`
	let pending = ""
	let capturing = state.capturing
	let capturedContent = state.capturedContent
	let cursor = 0
	let sawOpen = false
	let sawClose = false
	while (cursor < buffer.length) {
		if (capturing === false) {
			const rest = buffer.slice(cursor)
			const openPosRel = rest.indexOf(PLAN_OPEN_TAG)
			if (openPosRel >= 0) {
				cursor = cursor + openPosRel + PLAN_OPEN_TAG.length
				capturing = true
				capturedContent = ""
				sawOpen = true
				continue
			}
			const keep = Math.min(PLAN_OPEN_TAG.length - 1, buffer.length - cursor)
			if (keep > 0) {
				pending = buffer.slice(buffer.length - keep)
			}
			break
		}
		const rest = buffer.slice(cursor)
		const closePosRel = rest.indexOf(PLAN_CLOSE_TAG)
		if (closePosRel >= 0) {
			const closePos = cursor + closePosRel
			if (closePos > cursor) {
				capturedContent = `${capturedContent}${buffer.slice(cursor, closePos)}`
			}
			cursor = closePos + PLAN_CLOSE_TAG.length
			capturing = false
			sawClose = true
			continue
		}
		const keep = PLAN_CLOSE_TAG.length - 1
		const available = buffer.length - cursor
		if (available > keep) {
			const safeEnd = buffer.length - keep
			if (safeEnd >= cursor) {
				capturedContent = `${capturedContent}${buffer.slice(cursor, safeEnd)}`
				pending = buffer.slice(safeEnd)
			} else {
				pending = buffer.slice(cursor)
			}
		} else {
			pending = buffer.slice(cursor)
		}
		break
	}
	const nextState: CodexPlanTagState = {
		pending,
		capturing,
		capturedContent
	}
	if (sawClose) {
		return {
			plan: Option.some({
				contractKind: "plan_proposal",
				planMarkdown: capturedContent,
				streaming: false
			}),
			state: nextState
		}
	}
	if (sawOpen || capturing) {
		return {
			plan: Option.some({
				contractKind: "plan_proposal",
				planMarkdown: capturedContent,
				streaming: true
			}),
			state: nextState
		}
	}
	return { plan: Option.none(), state: nextState }
}

const finalizePlan = (state: CodexPlanTagState): Option.Option<PlanProposalFact> => {
	if (state.capturing === false) {
		return Option.none()
	}
	const content = `${state.capturedContent}${state.pending}`
	return Option.some({
		contractKind: "plan_proposal",
		planMarkdown: content,
		streaming: false
	})
}

const withPlan = (
	primary: ReadonlyArray<CodexContractFact>,
	plan: Option.Option<PlanProposalFact>
): ReadonlyArray<CodexContractFact> =>
	Option.match(plan, {
		onNone: () => primary,
		onSome: (fact) => Arr.append(primary, fact)
	})

const translateTextDelta = (
	params: JsonObject,
	thought: boolean
): Option.Option<CodexContractFact> => {
	const token = rawStringField(params, "delta")
	if (Option.isNone(token)) {
		return Option.none()
	}
	if (thought) {
		return Option.some({
			contractKind: "thought_delta",
			token: token.value
		})
	}
	const hint = classifyChunkAggregationHint(token.value)
	if (Option.isNone(hint)) {
		return Option.some({
			contractKind: "text_delta",
			token: token.value
		})
	}
	return Option.some({
		contractKind: "text_delta",
		token: token.value,
		aggregationHint: hint.value
	})
}

const translateItemTool = (
	params: JsonObject,
	completed: boolean
): Option.Option<CodexContractFact> => {
	const item = objectField(params, "item")
	if (Option.isNone(item)) {
		return Option.none()
	}
	const itemType = Option.getOrElse(stringField(item.value, "type"), () => "")
	if (isToolItemType(itemType) === false) {
		return Option.none()
	}
	const id = stringField(item.value, "id")
	if (Option.isNone(id)) {
		return Option.none()
	}
	const fields = extractToolFields(itemType, item.value)
	const status = toolStatusFromItem(item.value, completed)
	if (completed === false) {
		return Option.some({
			contractKind: "tool_call",
			toolCallId: id.value,
			title: fields.title,
			kind: fields.kind,
			status,
			rawInput: fields.rawInput
		})
	}
	const result = toolResult(item.value)
	if (Option.isNone(result)) {
		return Option.some({
			contractKind: "tool_call_update",
			toolCallId: id.value,
			status,
			title: fields.title
		})
	}
	return Option.some({
		contractKind: "tool_call_update",
		toolCallId: id.value,
		status,
		title: fields.title,
		result: result.value
	})
}

export const providerSessionFact = (providerSessionId: string): ProviderSessionFact => ({
	contractKind: "provider_session",
	providerSessionId
})

export const encodeContractFact = (fact: CodexContractFact): Option.Option<JsonObject> => {
	const encoded = encodeFact(fact)
	if (Exit.isFailure(encoded)) {
		return Option.none()
	}
	return jsonObjectOf(encoded.value)
}

export const decodeContractFact = (value: Json): Option.Option<CodexContractFact> => {
	const decoded = decodeFact(value)
	if (Exit.isFailure(decoded)) {
		return Option.none()
	}
	return Option.some(decoded.value)
}

export const isTurnTerminalFact = (fact: CodexContractFact): boolean =>
	fact.contractKind === "turn_complete" || fact.contractKind === "turn_error"

export const mapCodexServerMessage = (
	state: CodexMapState,
	sessionId: string,
	raw: Json
): CodexMapResult => {
	const record = jsonObjectOf(raw)
	if (Option.isNone(record)) {
		return { facts: Arr.empty(), state }
	}
	if (Option.isSome(field(record.value, "result")) || Option.isSome(field(record.value, "error"))) {
		return { facts: Arr.empty(), state }
	}
	const method = stringField(record.value, "method")
	if (Option.isNone(method)) {
		return { facts: Arr.empty(), state }
	}
	const params = Option.getOrElse(objectField(record.value, "params"), () => EMPTY_JSON_OBJECT)
	if (method.value === AGENT_MESSAGE_DELTA_METHOD) {
		const delta = translateTextDelta(params, false)
		const token = Option.match(delta, {
			onNone: () => "",
			onSome: (fact) => (fact.contractKind === "text_delta" ? fact.token : "")
		})
		const planned = processPlanChunk(state.plan, token)
		const primary = Option.match(delta, {
			onNone: () => Arr.empty<CodexContractFact>(),
			onSome: (fact) => Arr.of(fact)
		})
		return {
			facts: withPlan(primary, planned.plan),
			state: { plan: planned.state }
		}
	}
	if (method.value === REASONING_TEXT_DELTA_METHOD || method.value === REASONING_SUMMARY_DELTA_METHOD) {
		const delta = translateTextDelta(params, true)
		const token = Option.match(delta, {
			onNone: () => "",
			onSome: (fact) => (fact.contractKind === "thought_delta" ? fact.token : "")
		})
		const planned = processPlanChunk(state.plan, token)
		const primary = Option.match(delta, {
			onNone: () => Arr.empty<CodexContractFact>(),
			onSome: (fact) => Arr.of(fact)
		})
		return {
			facts: withPlan(primary, planned.plan),
			state: { plan: planned.state }
		}
	}
	if (
		method.value === COMMAND_APPROVAL_METHOD ||
		method.value === FILE_READ_APPROVAL_METHOD ||
		method.value === FILE_CHANGE_APPROVAL_METHOD
	) {
		const id = stringifyJsonRpcId(field(record.value, "id"))
		if (Option.isNone(id)) {
			return { facts: Arr.empty(), state }
		}
		const toolCallId = Option.getOrUndefined(stringField(params, "itemId"))
		const permission: PermissionRequestFact =
			toolCallId === undefined
				? {
						contractKind: "permission_request",
						id: id.value,
						sessionId,
						permission: permissionLabel(method.value, params),
						always: ["allow_always"]
					}
				: {
						contractKind: "permission_request",
						id: id.value,
						sessionId,
						permission: permissionLabel(method.value, params),
						toolCallId,
						always: ["allow_always"]
					}
		return { facts: Arr.of(permission), state }
	}
	if (method.value === USER_INPUT_REQUEST_METHOD) {
		const questions = parseQuestions(params)
		if (questions.length === 0) {
			return { facts: Arr.empty(), state }
		}
		const id = Option.getOrElse(stringifyJsonRpcId(field(record.value, "id")), () =>
			Option.getOrElse(stringField(params, "itemId"), () => "codex-user-input")
		)
		const toolCallId = Option.getOrUndefined(stringField(params, "itemId"))
		const fact: QuestionRequestFact =
			toolCallId === undefined
				? {
						contractKind: "question_request",
						id,
						sessionId,
						questions
					}
				: {
						contractKind: "question_request",
						id,
						sessionId,
						toolCallId,
						questions
					}
		return { facts: Arr.of(fact), state }
	}
	if (method.value === TURN_COMPLETED_METHOD) {
		const turnId = Option.getOrUndefined(extractTurnId(params))
		const turn = objectField(params, "turn")
		const status = Option.getOrElse(
			Option.flatMap(turn, (entry) => stringField(entry, "status")),
			() => "completed"
		)
		if (status === "failed") {
			const detail = Option.getOrElse(
				Option.flatMap(turn, (entry) =>
					Option.flatMap(objectField(entry, "error"), (error) => stringField(error, "message"))
				),
				() => "Codex turn failed"
			)
			const errorFact: TurnErrorFact =
				turnId === undefined
					? { contractKind: "turn_error", detail }
					: { contractKind: "turn_error", detail, turnId }
			const flushed = finalizePlan(state.plan)
			return {
				facts: withPlan(Arr.of(errorFact), flushed),
				state: { plan: emptyCodexPlanTagState }
			}
		}
		const complete: TurnCompleteFact =
			turnId === undefined
				? { contractKind: "turn_complete" }
				: { contractKind: "turn_complete", turnId }
		const flushed = finalizePlan(state.plan)
		return {
			facts: withPlan(Arr.of(complete), flushed),
			state: { plan: emptyCodexPlanTagState }
		}
	}
	if (method.value === ERROR_METHOD) {
		if (Option.getOrElse(booleanField(params, "willRetry"), () => false)) {
			return { facts: Arr.empty(), state }
		}
		const detail = Option.getOrElse(
			Option.flatMap(objectField(params, "error"), (error) => stringField(error, "message")),
			() => "Codex transport error"
		)
		const turnId = Option.getOrUndefined(extractTurnId(params))
		const errorFact: TurnErrorFact =
			turnId === undefined
				? { contractKind: "turn_error", detail }
				: { contractKind: "turn_error", detail, turnId }
		const flushed = finalizePlan(state.plan)
		return {
			facts: withPlan(Arr.of(errorFact), flushed),
			state: { plan: emptyCodexPlanTagState }
		}
	}
	if (method.value === ITEM_STARTED_METHOD) {
		const fact = translateItemTool(params, false)
		return {
			facts: Option.match(fact, {
				onNone: () => Arr.empty<CodexContractFact>(),
				onSome: (value) => Arr.of(value)
			}),
			state
		}
	}
	if (method.value === ITEM_COMPLETED_METHOD) {
		const fact = translateItemTool(params, true)
		return {
			facts: Option.match(fact, {
				onNone: () => Arr.empty<CodexContractFact>(),
				onSome: (value) => Arr.of(value)
			}),
			state
		}
	}
	if (method.value === TOKEN_USAGE_UPDATED_METHOD) {
		const usage = translateTokenUsage(sessionId, params)
		return {
			facts: Option.match(usage, {
				onNone: () => Arr.empty<CodexContractFact>(),
				onSome: (value) => Arr.of(value)
			}),
			state
		}
	}
	if (method.value === ACCOUNT_RATE_LIMITS_UPDATED_METHOD) {
		return { facts: Arr.empty(), state }
	}
	return { facts: Arr.empty(), state }
}
