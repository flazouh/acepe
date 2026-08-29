import * as Schema from "effect/Schema"

// The agentCall utility RPC (see rpc.ts). Same shape as the gitCall utility
// RPC (gitCall.ts) -- a tagged-union request routed server-side onto a
// switch on `op`, growing one union member at a time as new agent-
// management operations get a real backend. See gitCall.ts's header
// comment and the #249 issue thread's DESIGN DECISION for why a utility
// RPC beats adding a new top-level RPC primitive per operation.
//
// This slice carries agentCall's one live caller: backend-client/acp.ts's
// listAgents, which the New-chat agent picker (agent-manager.ts,
// acp/store/api.ts) needs populated to offer any agent at all. install/
// uninstall/registerCustomAgent/authenticate* stay unsupportedOnContract in
// the facade -- see acp.ts's header comment -- until a real backend exists
// for them; each becomes a new request/result union member here, exactly
// like gitCall.ts's ops did one sub-domain at a time.

export const AgentCallAvailabilityKind = Schema.Struct({
	kind: Schema.Literal("installable"),
	installed: Schema.Boolean
})
export type AgentCallAvailabilityKind = typeof AgentCallAvailabilityKind.Type

export const AgentCallAgentInfo = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	availabilityKind: AgentCallAvailabilityKind
})
export type AgentCallAgentInfo = typeof AgentCallAgentInfo.Type

// ─── agent management ──────────────────────────────────────────────────────

export const AgentCallListAgentsRequest = Schema.Struct({
	op: Schema.Literal("agent.list")
})
export type AgentCallListAgentsRequest = typeof AgentCallListAgentsRequest.Type

export const AgentCallListAgentsResult = Schema.Struct({
	op: Schema.Literal("agent.list"),
	agents: Schema.Array(AgentCallAgentInfo)
})
export type AgentCallListAgentsResult = typeof AgentCallListAgentsResult.Type

// ─── unions ───────────────────────────────────────────────────────────────

export const AgentCallRequest = Schema.Union([AgentCallListAgentsRequest])
export type AgentCallRequest = typeof AgentCallRequest.Type

export const AgentCallResult = Schema.Union([AgentCallListAgentsResult])
export type AgentCallResult = typeof AgentCallResult.Type
