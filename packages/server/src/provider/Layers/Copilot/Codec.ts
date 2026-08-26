import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { makeFactCodec } from "../FactCodec.ts"
import { applyOptional, type Json, type JsonObject } from "../Json.ts"
import { CopilotContractFact, type UsageFact } from "./Facts.ts"
import { mapAcpUpdate } from "./Map.ts"

export const { decodeContractFact, encodeContractFact } = makeFactCodec(CopilotContractFact)

// The eventId rides the projection so a reader of the session update sees the
// dedup key instead of re-deriving it. Map.ts derives it back from the same
// figures, which is what keeps the round-trip stable.
const usageToAcp = (fact: UsageFact): JsonObject => {
	const base: JsonObject = {
		type: "usage",
		sessionId: fact.sessionId
	}
	return applyOptional(
		applyOptional(
			applyOptional(
				applyOptional(
					applyOptional(
						applyOptional(base, fact.eventId, (current, value) => ({
							...current,
							eventId: value
						})),
						fact.inputTokens,
						(current, value) => ({
							...current,
							inputTokens: value
						})
					),
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
