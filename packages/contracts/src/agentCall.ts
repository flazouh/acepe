import * as Schema from "effect/Schema"

// The agentCall utility RPC (see rpc.ts). Same shape as the gitCall utility
// RPC (gitCall.ts) -- a tagged-union request routed server-side onto a
// switch on `op`, growing one union member at a time as new agent-
// management operations get a real backend. See gitCall.ts's header
// comment and the #249 issue thread's DESIGN DECISION for why a utility
// RPC beats adding a new top-level RPC primitive per operation.
//
// This slice carries agent.list (the New-chat agent picker's source of
// agents) plus agent.install/agent.uninstall, which run the server's
// AgentInstaller (packages/server/src/provider/Layers/AgentInstaller.ts)
// and answer with the agent list re-read from ProviderRegistry afterwards.
//
// TRANSPORT CHOICE. The other candidate was the orchestration command lane:
// `agent.install` is already a command type and acpDecide.ts already
// handles it. It was rejected. That decider is an echo -- it emits an
// AgentInstalled event straight from the command payload without anything
// downloading a byte, so dispatching it records an "installed" fact that
// may be false, and it writes that fact into the event store, where nothing
// reads installedness from. Installedness is answered by ProviderRegistry
// presence, so the operation that changes it belongs on the same request/
// response lane that reads it. One transport, one authority.
//
// PROGRESS. This lane is request/response: there is no channel for a
// download-progress tick, and the installer emits none. The picker row
// therefore shows an indeterminate "Installing..." state instead of a
// percentage -- see agent-input-agent-selector.svelte. A percentage would
// need a streaming RPC and a progress-reporting installer, which is not
// what this slice buys.
//
// registerCustomAgent/authenticate* stay unsupportedOnContract in the
// facade -- see backend-client/acp.ts's header comment -- until they get a
// real backend; each becomes a new request/result union member here,
// exactly like gitCall.ts's ops did one sub-domain at a time.

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

export const AgentCallInstallAgentRequest = Schema.Struct({
	op: Schema.Literal("agent.install"),
	agentId: Schema.String
})
export type AgentCallInstallAgentRequest = typeof AgentCallInstallAgentRequest.Type

// `version` is the installer's durable outcome for this agent: the version
// now on disk under the managed cache directory. `agents` is the agent list
// re-read from ProviderRegistry after the install, so a caller never has to
// keep its own idea of which agents are installed.
export const AgentCallInstallAgentResult = Schema.Struct({
	op: Schema.Literal("agent.install"),
	agentId: Schema.String,
	version: Schema.String,
	agents: Schema.Array(AgentCallAgentInfo)
})
export type AgentCallInstallAgentResult = typeof AgentCallInstallAgentResult.Type

export const AgentCallUninstallAgentRequest = Schema.Struct({
	op: Schema.Literal("agent.uninstall"),
	agentId: Schema.String
})
export type AgentCallUninstallAgentRequest = typeof AgentCallUninstallAgentRequest.Type

export const AgentCallUninstallAgentResult = Schema.Struct({
	op: Schema.Literal("agent.uninstall"),
	agentId: Schema.String,
	agents: Schema.Array(AgentCallAgentInfo)
})
export type AgentCallUninstallAgentResult = typeof AgentCallUninstallAgentResult.Type

// ─── unions ───────────────────────────────────────────────────────────────

export const AgentCallRequest = Schema.Union([
	AgentCallListAgentsRequest,
	AgentCallInstallAgentRequest,
	AgentCallUninstallAgentRequest
])
export type AgentCallRequest = typeof AgentCallRequest.Type

export const AgentCallResult = Schema.Union([
	AgentCallListAgentsResult,
	AgentCallInstallAgentResult,
	AgentCallUninstallAgentResult
])
export type AgentCallResult = typeof AgentCallResult.Type
