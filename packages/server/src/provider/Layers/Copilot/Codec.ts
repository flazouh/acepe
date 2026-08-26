import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { CopilotContractFact, type UsageFact } from "./Facts.ts"
import { applyOptional, jsonObjectOf, mapAcpUpdate } from "./Map.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const decodeFact = Schema.decodeUnknownExit(CopilotContractFact)
const encodeFact = Schema.encodeUnknownExit(CopilotContractFact)

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
