import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const EMPTY_JSON_OBJECT: JsonObject = {}

export const COPILOT_ACP_TOOL_KINDS = [
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
export const CopilotAcpToolKind = Schema.Literals(COPILOT_ACP_TOOL_KINDS)
export type CopilotAcpToolKind = typeof CopilotAcpToolKind.Type

export const CopilotToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"])
export type CopilotToolStatus = typeof CopilotToolStatus.Type

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
	kind: CopilotAcpToolKind,
	status: CopilotToolStatus,
	rawInput: Schema.JsonObject
})
export type ToolCallFact = typeof ToolCallFact.Type

export const ToolCallUpdateFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call_update"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	status: Schema.optionalKey(CopilotToolStatus),
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

export const CopilotContractFact = Schema.Union([
	TextDeltaFact,
	ThoughtDeltaFact,
	ToolCallFact,
	ToolCallUpdateFact,
	PermissionRequestFact,
	PlanProposalFact,
	UsageFact,
	ProviderSessionFact,
	TurnCompleteFact,
	TurnErrorFact
])
export type CopilotContractFact = typeof CopilotContractFact.Type

const decodeFact = Schema.decodeUnknownExit(CopilotContractFact)
const encodeFact = Schema.encodeUnknownExit(CopilotContractFact)
const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const decodeToolKind = Schema.decodeUnknownExit(CopilotAcpToolKind)

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

const objectField = (record: JsonObject, key: string): Option.Option<JsonObject> =>
	Option.flatMap(field(record, key), jsonObjectOf)

const rawInputOf = (value: Json | undefined): JsonObject => {
	if (value === undefined) {
		return EMPTY_JSON_OBJECT
	}
	return Option.getOrElse(jsonObjectOf(value), () => EMPTY_JSON_OBJECT)
}

const normalizeToolName = (name: string): string => {
	const trimmed = Str.trim(name)
	if (Str.startsWith("mcp__")(trimmed)) {
		return Option.getOrElse(Arr.last(Str.split(trimmed, "__")), () => trimmed)
	}
	return trimmed
}

const foldedName = (name: string): string =>
	Str.toLowerCase(Str.replaceAll(/[\s_-]/g, "")(normalizeToolName(name)))

const COPILOT_TOOL_KIND_BY_FOLDED = HashMap.fromIterable([
	["read", "read"],
	["readfile", "read"],
	["view", "read"],
	["notebookread", "read"],
	["readlints", "read_lints"],
	["edit", "edit"],
	["editfile", "edit"],
	["write", "edit"],
	["writefile", "edit"],
	["strreplace", "edit"],
	["strreplaceeditor", "edit"],
	["applypatch", "edit"],
	["bash", "execute"],
	["execute", "execute"],
	["shell", "execute"],
	["run", "execute"],
	["terminal", "execute"],
	["killshell", "execute"],
	["killbash", "execute"],
	["glob", "glob"],
	["ls", "glob"],
	["find", "glob"],
	["grep", "search"],
	["rg", "search"],
	["ripgrep", "search"],
	["search", "search"],
	["webfetch", "fetch"],
	["fetch", "fetch"],
	["http", "fetch"],
	["websearch", "web_search"],
	["web", "web_search"],
	["think", "think"],
	["todowrite", "todo"],
	["todoread", "todo"],
	["todo", "todo"],
	["updatetodos", "todo"],
	["marktodo", "todo"],
	["tasklist", "todo"],
	["todos", "todo"],
	["askuserquestion", "question"],
	["askuser", "question"],
	["question", "question"],
	["task", "task"],
	["spawn", "task"],
	["agent", "task"],
	["subagent", "task"],
	["taskcreate", "task"],
	["taskupdate", "task"],
	["skill", "skill"],
	["enterplanmode", "enter_plan_mode"],
	["exitplanmode", "exit_plan_mode"],
	["createplan", "exit_plan_mode"]
] satisfies ReadonlyArray<readonly [string, CopilotAcpToolKind]>)

export const detectCopilotToolKind = (name: string): CopilotAcpToolKind =>
	Option.getOrElse(HashMap.get(COPILOT_TOOL_KIND_BY_FOLDED, foldedName(name)), () => "other")

export const permissionIdForToolCall = (toolCallId: string): string => `perm-${toolCallId}`

export const permissionNameForToolKind = (kind: CopilotAcpToolKind): string => {
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

const asToolStatus = (value: string): Option.Option<CopilotToolStatus> => {
	if (value === "pending" || value === "in_progress" || value === "completed" || value === "failed") {
		return Option.some(value)
	}
	return Option.none()
}

const asToolKind = (value: string): CopilotAcpToolKind => {
	const decoded = decodeToolKind(value)
	if (Exit.isSuccess(decoded)) {
		return decoded.value
	}
	return detectCopilotToolKind(value)
}

const tokenFromContent = (record: JsonObject): Option.Option<string> => {
	const direct = stringField(record, "token")
	if (Option.isSome(direct)) {
		return direct
	}
	const content = objectField(record, "content")
	if (Option.isNone(content)) {
		return stringField(record, "text")
	}
	return stringFieldAny(content.value, ["text", "thinking"])
}

const updateName = (record: JsonObject): string =>
	Option.getOrElse(stringFieldAny(record, ["sessionUpdate", "type"]), () => "")

const unwrapUpdate = (raw: Json): JsonObject => {
	const record = jsonObjectOf(raw)
	if (Option.isNone(record)) {
		return EMPTY_JSON_OBJECT
	}
	const method = Option.getOrElse(stringField(record.value, "method"), () => "")
	if (method === "session/update") {
		const params = objectField(record.value, "params")
		if (Option.isNone(params)) {
			return record.value
		}
		return Option.getOrElse(objectField(params.value, "update"), () => params.value)
	}
	return record.value
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

const usageCostUsd = (record: JsonObject): Option.Option<number> =>
	Option.match(objectField(record, "cost"), {
		onNone: () => numberField(record, "costUsd"),
		onSome: (value) => numberField(value, "amount")
	})

const usageFact = (record: JsonObject, sessionId: string): UsageFact => {
	const inputTokens = numberField(record, "inputTokens")
	const outputTokens = numberField(record, "outputTokens")
	const totalTokens =
		Option.isNone(inputTokens) && Option.isNone(outputTokens)
			? numberField(record, "used")
			: Option.none()
	const contextWindowSize = Option.orElse(numberField(record, "contextWindowSize"), () =>
		numberField(record, "size")
	)
	const base: UsageFact = {
		contractKind: "usage",
		sessionId
	}
	return applyUsageNumber(
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
			usageCostUsd(record),
			withUsageCost
		),
		contextWindowSize,
		withUsageWindow
	)
}

const withToolCallUpdateStatus = (
	fact: ToolCallUpdateFact,
	status: CopilotToolStatus
): ToolCallUpdateFact => ({
	...fact,
	status
})

const withToolCallUpdatePartial = (
	fact: ToolCallUpdateFact,
	partialJson: string
): ToolCallUpdateFact => ({
	...fact,
	partialJson
})

const applyOptional = <A, T>(
	current: A,
	value: T | undefined,
	apply: (next: A, present: T) => A
): A => {
	if (value === undefined) {
		return current
	}
	return apply(current, value)
}

const toolCallUpdateFact = (
	toolCallId: string,
	status: Option.Option<CopilotToolStatus>,
	partialJson: string | undefined
): ToolCallUpdateFact => {
	const base: ToolCallUpdateFact = {
		contractKind: "tool_call_update",
		toolCallId
	}
	return applyOptional(
		Option.match(status, {
			onNone: () => base,
			onSome: (value) => withToolCallUpdateStatus(base, value)
		}),
		partialJson,
		withToolCallUpdatePartial
	)
}

const withPlanToolCallId = (fact: PlanProposalFact, toolCallId: string): PlanProposalFact => ({
	...fact,
	toolCallId
})

const mapNamedUpdate = (record: JsonObject, typeName: string): ReadonlyArray<CopilotContractFact> => {
	if (typeName === "agent_message_chunk" || typeName === "agentMessageChunk") {
		const token = tokenFromContent(record)
		if (Option.isNone(token)) {
			return Arr.empty()
		}
		return [{ contractKind: "text_delta", token: token.value }]
	}
	if (typeName === "agent_thought_chunk" || typeName === "agentThoughtChunk") {
		const token = tokenFromContent(record)
		if (Option.isNone(token)) {
			return Arr.empty()
		}
		return [{ contractKind: "thought_delta", token: token.value }]
	}
	if (typeName === "tool_call" || typeName === "toolCall" || typeName === "tool_use") {
		const toolCallId = stringFieldAny(record, ["toolCallId", "tool_call_id", "id"])
		const title = Option.getOrElse(stringFieldAny(record, ["title", "name"]), () => "tool")
		const status = Option.getOrElse(
			Option.flatMap(stringField(record, "status"), asToolStatus),
			() => "pending" as const
		)
		if (Option.isNone(toolCallId)) {
			return Arr.empty()
		}
		const kindHint = stringField(record, "kind")
		return [
			{
				contractKind: "tool_call",
				toolCallId: toolCallId.value,
				title,
				kind: asToolKind(Option.getOrElse(kindHint, () => title)),
				status,
				rawInput: field(record, "rawInput").pipe(Option.getOrUndefined, rawInputOf)
			}
		]
	}
	if (typeName === "tool_call_update" || typeName === "toolCallUpdate" || typeName === "tool_result") {
		const toolCallId = stringFieldAny(record, ["toolCallId", "tool_call_id"])
		if (Option.isNone(toolCallId)) {
			return Arr.empty()
		}
		const status = Option.flatMap(stringField(record, "status"), asToolStatus)
		const partialJson = Option.getOrUndefined(stringField(record, "partialJson"))
		return [toolCallUpdateFact(toolCallId.value, status, partialJson)]
	}
	if (typeName === "permissionRequest" || typeName === "permission_request") {
		const nested = Option.getOrElse(objectField(record, "permissionRequest"), () => record)
		const id = stringField(nested, "id")
		const sessionId = stringFieldAny(nested, ["sessionId", "session_id"])
		const permission = stringField(nested, "permission")
		const toolCallId = stringFieldAny(nested, ["toolCallId", "tool_call_id"])
		if (
			Option.isNone(id) ||
			Option.isNone(sessionId) ||
			Option.isNone(permission) ||
			Option.isNone(toolCallId)
		) {
			return Arr.empty()
		}
		return [
			{
				contractKind: "permission_request",
				id: id.value,
				sessionId: sessionId.value,
				permission: permission.value,
				toolCallId: toolCallId.value
			}
		]
	}
	if (typeName === "plan" || typeName === "plan_proposal") {
		const planMarkdown = stringFieldAny(record, ["planMarkdown", "plan"])
		if (Option.isNone(planMarkdown)) {
			return Arr.empty()
		}
		const base: PlanProposalFact = {
			contractKind: "plan_proposal",
			planMarkdown: planMarkdown.value
		}
		return [
			applyOptional(
				base,
				Option.getOrUndefined(stringField(record, "toolCallId")),
				withPlanToolCallId
			)
		]
	}
	if (
		typeName === "usage" ||
		typeName === "usageUpdate" ||
		typeName === "usage_update" ||
		typeName === "usageTelemetryUpdate"
	) {
		const sessionId = stringFieldAny(record, ["sessionId", "session_id"])
		if (Option.isNone(sessionId)) {
			return Arr.empty()
		}
		return [usageFact(record, sessionId.value)]
	}
	if (typeName === "turn_complete") {
		return [{ contractKind: "turn_complete" }]
	}
	if (typeName === "turn_error") {
		const detail = stringField(record, "detail")
		if (Option.isNone(detail)) {
			return Arr.empty()
		}
		return [{ contractKind: "turn_error", detail: detail.value }]
	}
	if (typeName === "provider_session") {
		const providerSessionId = stringField(record, "providerSessionId")
		if (Option.isNone(providerSessionId)) {
			return Arr.empty()
		}
		return [
			{
				contractKind: "provider_session",
				providerSessionId: providerSessionId.value
			}
		]
	}
	return Arr.empty()
}

export const mapAcpUpdate = (raw: Json): ReadonlyArray<CopilotContractFact> => {
	const record = unwrapUpdate(raw)
	return mapNamedUpdate(record, updateName(record))
}

export const mapPromptResult = (raw: Json): CopilotContractFact => {
	const record = jsonObjectOf(raw)
	const stopReason = Option.match(record, {
		onNone: () => "",
		onSome: (value) => Option.getOrElse(stringField(value, "stopReason"), () => "")
	})
	if (stopReason === "refusal") {
		return { contractKind: "turn_error", detail: "refusal" }
	}
	return { contractKind: "turn_complete" }
}

export const encodeContractFact = (fact: CopilotContractFact): Option.Option<JsonObject> => {
	const encoded = encodeFact(fact)
	if (Exit.isFailure(encoded)) {
		return Option.none()
	}
	return jsonObjectOf(encoded.value)
}

export const decodeContractFact = (value: Json): Option.Option<CopilotContractFact> => {
	const decoded = decodeFact(value)
	if (Exit.isFailure(decoded)) {
		return Option.none()
	}
	return Option.some(decoded.value)
}

export const permissionRequestFact = (input: {
	readonly sessionId: string
	readonly toolCallId: string
	readonly toolName: string
}): PermissionRequestFact => ({
	contractKind: "permission_request",
	id: permissionIdForToolCall(input.toolCallId),
	sessionId: input.sessionId,
	permission: permissionNameForToolKind(detectCopilotToolKind(input.toolName)),
	toolCallId: input.toolCallId
})

export const providerSessionFact = (providerSessionId: string): ProviderSessionFact => ({
	contractKind: "provider_session",
	providerSessionId
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

const usageToAcp = (fact: UsageFact): JsonObject => {
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

export const contractFactToAcpSessionUpdate = (fact: CopilotContractFact): JsonObject => {
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
	if (fact.contractKind === "text_delta") {
		return { type: "agent_message_chunk", token: fact.token }
	}
	if (fact.contractKind === "thought_delta") {
		return { type: "agent_thought_chunk", token: fact.token }
	}
	if (fact.contractKind === "tool_call_update") {
		const base: JsonObject = {
			type: "tool_call_update",
			toolCallId: fact.toolCallId
		}
		return applyOptional(
			applyOptional(base, fact.status, (current, status) => ({
				...current,
				status
			})),
			fact.partialJson,
			(current, partialJson) => ({
				...current,
				partialJson
			})
		)
	}
	if (fact.contractKind === "plan_proposal") {
		const base: JsonObject = {
			type: "plan_proposal",
			planMarkdown: fact.planMarkdown
		}
		return applyOptional(base, fact.toolCallId, (current, toolCallId) => ({
			...current,
			toolCallId
		}))
	}
	if (fact.contractKind === "usage") {
		return usageToAcp(fact)
	}
	if (fact.contractKind === "provider_session") {
		return { type: "provider_session", providerSessionId: fact.providerSessionId }
	}
	if (fact.contractKind === "turn_complete") {
		return { type: "turn_complete" }
	}
	return { type: "turn_error", detail: fact.detail }
}

export const acpSessionUpdateToFact = (payload: Json): Option.Option<CopilotContractFact> =>
	Arr.head(mapAcpUpdate(payload))

export const roundTripAcpSessionUpdate = (payload: Json): Option.Option<JsonObject> =>
	Option.map(acpSessionUpdateToFact(payload), contractFactToAcpSessionUpdate)

export const isTurnTerminalFact = (fact: CopilotContractFact): boolean =>
	fact.contractKind === "turn_complete" || fact.contractKind === "turn_error"
