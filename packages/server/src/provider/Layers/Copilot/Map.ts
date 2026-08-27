import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { acpToolOutput } from "../AcpContent.ts"
import {
	applyOptional,
	EMPTY_JSON_OBJECT,
	field,
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
	type CopilotContractFact,
	type CopilotToolStatus,
	type PlanProposalFact,
	type ToolCallUpdateFact,
	type UsageFact
} from "./Facts.ts"
import { asToolKind, permissionRequestFact } from "./Tools.ts"
import { SESSION_REQUEST_PERMISSION_METHOD, SESSION_UPDATE_METHOD } from "./Wire.ts"

const rawInputOf = (value: Json | undefined): JsonObject => {
	if (value === undefined) {
		return EMPTY_JSON_OBJECT
	}
	return Option.getOrElse(jsonObjectOf(value), () => EMPTY_JSON_OBJECT)
}

const asToolStatus = (value: string): Option.Option<CopilotToolStatus> => {
	if (value === "pending" || value === "in_progress" || value === "completed" || value === "failed") {
		return Option.some(value)
	}
	return Option.none()
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
	if (method === SESSION_UPDATE_METHOD) {
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

// The nested `cost.amount` wins because it is the most specific shape Copilot
// sends. The flat spellings are the ones Claude accepts (Claude/Map.ts:308), and
// reading a key that was ignored before can only recover a figure the provider
// sent, never invent one.
const usageCostUsd = (record: JsonObject): Option.Option<number> =>
	Option.match(objectField(record, "cost"), {
		onNone: () => numberFieldAny(record, ["costUsd", "cost_usd", "total_cost_usd"]),
		onSome: (value) => numberField(value, "amount")
	})

const formatOptionalNumber = (value: Option.Option<number>): string =>
	Option.match(value, {
		onNone: () => "none",
		onSome: (number) => String(number)
	})

const usageFact = (record: JsonObject, sessionId: string): UsageFact => {
	const inputTokens = numberField(record, "inputTokens")
	const outputTokens = numberField(record, "outputTokens")
	// An explicit provider total is read unconditionally. `used` is not one: it is
	// context-window occupancy against the `size` read two lines down, so a payload
	// can report `used: 41000` for a 16-token turn. No recorded Copilot payload
	// proves either reading, so `used` only stands in for a total when no breakdown
	// ships, which is the reading that cannot put an occupancy figure in the total
	// slot of a fact that already carries 12 in and 4 out. Giving occupancy its own
	// `UsageFact` field is a contract change, tracked in #279.
	const totalTokens = Option.orElse(numberFieldAny(record, ["totalTokens", "total_tokens"]), () =>
		Option.isNone(inputTokens) && Option.isNone(outputTokens)
			? numberField(record, "used")
			: Option.none()
	)
	const contextWindowSize = numberFieldAny(record, [
		"contextWindowSize",
		"context_window_size",
		"size"
	])
	const costUsd = usageCostUsd(record)
	// The dedup key the desktop reads as lastTelemetryEventId, built the way
	// Codex/Map.ts builds its own: a composite of the conversation id and every
	// figure the reading carries, so a replayed identical reading collapses onto
	// one id and a reading that differs by a single token gets its own. Copilot's
	// usage update carries no turn id, so the session id is the only conversation
	// id available. An absent figure is named "none" rather than dropped, or a
	// reading of 4 output tokens and no cost would share an id with a reading of
	// no output tokens and a cost of 4.
	const eventId =
		`copilot-token-usage:${sessionId}:total=${formatOptionalNumber(totalTokens)}:input=${formatOptionalNumber(inputTokens)}:output=${formatOptionalNumber(outputTokens)}:cost=${formatOptionalNumber(costUsd)}:context=${formatOptionalNumber(contextWindowSize)}`
	const base: UsageFact = {
		contractKind: "usage",
		sessionId,
		eventId
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
			costUsd,
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

const withToolCallUpdateOutput = (
	fact: ToolCallUpdateFact,
	output: string
): ToolCallUpdateFact => ({
	...fact,
	output
})

const toolCallUpdateFact = (
	toolCallId: string,
	status: Option.Option<CopilotToolStatus>,
	partialJson: string | undefined,
	output: string | undefined
): ToolCallUpdateFact => {
	const base: ToolCallUpdateFact = {
		contractKind: "tool_call_update",
		toolCallId
	}
	return applyOptional(
		applyOptional(
			Option.match(status, {
				onNone: () => base,
				onSome: (value) => withToolCallUpdateStatus(base, value)
			}),
			partialJson,
			withToolCallUpdatePartial
		),
		output,
		withToolCallUpdateOutput
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
		const output = Option.getOrUndefined(acpToolOutput(record))
		return [toolCallUpdateFact(toolCallId.value, status, partialJson, output)]
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

// ACP asks for a permission with a JSON-RPC REQUEST, not a session/update
// notification: the params carry the sessionId, the toolCall and the options
// an answer picks from. Acepe owns the approval id and derives it from the
// tool call, because ACP gives the client none of its own — see
// permissionRequestFact in Tools.ts.
const mapAcpPermissionRequest = (params: JsonObject): ReadonlyArray<CopilotContractFact> => {
	const sessionId = stringFieldAny(params, ["sessionId", "session_id"])
	const toolCall = objectField(params, "toolCall")
	if (Option.isNone(sessionId) || Option.isNone(toolCall)) {
		return Arr.empty()
	}
	const toolCallId = stringFieldAny(toolCall.value, ["toolCallId", "tool_call_id"])
	if (Option.isNone(toolCallId)) {
		return Arr.empty()
	}
	const toolName = Option.getOrElse(
		stringFieldAny(toolCall.value, ["kind", "title"]),
		() => "other"
	)
	return [
		permissionRequestFact({
			sessionId: sessionId.value,
			toolCallId: toolCallId.value,
			toolName
		})
	]
}

export const mapAcpUpdate = (raw: Json): ReadonlyArray<CopilotContractFact> => {
	const envelope = jsonObjectOf(raw)
	if (Option.isSome(envelope)) {
		const method = Option.getOrElse(stringField(envelope.value, "method"), () => "")
		if (method === SESSION_REQUEST_PERMISSION_METHOD) {
			return Option.match(objectField(envelope.value, "params"), {
				onNone: () => Arr.empty<CopilotContractFact>(),
				onSome: mapAcpPermissionRequest
			})
		}
	}
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
