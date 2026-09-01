import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { makeFactCodec } from "../FactCodec.ts"
import {
	applyOptional,
	booleanField,
	EMPTY_JSON_OBJECT,
	type Json,
	type JsonObject,
	jsonObjectOf,
	objectField,
	stringField
} from "../Json.ts"
import {
	ClaudeAcpToolKind,
	ClaudeContractFact,
	type ClaudeCompactionStatus,
	type ClaudeCompactionTrigger,
	type ClaudeToolStatus
} from "./Facts.ts"
import { compactionFromRecord, usageFromRecord } from "./Map.ts"
import { detectClaudeToolKind } from "./Tools.ts"

const decodeToolKind = Schema.decodeUnknownExit(ClaudeAcpToolKind)

export const { decodeContractFact, encodeContractFact } = makeFactCodec(ClaudeContractFact)

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
		const withNumbers = applyOptional(
			applyOptional(
				applyOptional(
					applyOptional(
						applyOptional(
							applyOptional(base, fact.preCompactionTokens, withAcpPre),
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
		return applyOptional(
			applyOptional(
				applyOptional(
					applyOptional(
						applyOptional(base, fact.inputTokens, (current, value) => ({
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
	// Unreachable via this path in practice: current_model comes only from the
	// SDK's system/init (Map.ts), never from an ACP session update that
	// acpSessionUpdateToFact could produce. Handled for exhaustiveness, and
	// symmetric with provider_session above so it round-trips its own data.
	if (fact.contractKind === "current_model") {
		return { type: "current_model", modelId: fact.modelId }
	}
	if (fact.contractKind === "turn_complete") {
		return { type: "turn_complete" }
	}
	if (fact.contractKind === "auth_required") {
		return { type: "auth_required" }
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
