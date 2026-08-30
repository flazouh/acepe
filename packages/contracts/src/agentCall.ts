import * as Schema from "effect/Schema"

import { SessionModelCatalog } from "./sessionModels.ts"

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
// SIGN-IN. agent.authenticate/agent.cancel-authentication joined this lane
// for the same reason install did. The orchestration `agent.authenticate`
// command is an echo too -- acpDecide.ts emits an AgentAuthenticated event
// straight from the command payload, so dispatching it records "this agent
// is signed in" without a single credential having been exchanged, and
// nothing reads authenticatedness from the event store. Nothing reads it from
// anywhere: what settles it is starting a session, which is why the result
// below reports no authenticated flag of its own.
//
// What actually signs an agent in is that agent's own CLI: `claude auth
// login`, `codex login`, `copilot login`, `cursor-agent login`. Each opens
// the operator's browser, completes an OAuth round trip and writes a token
// into its own credential store. Acepe spawns the command and waits for it
// to exit; no token is ever read, logged, held or forwarded by Acepe. The
// call is long-running by nature, which is what the request/response lane
// buys from the RPC transport's no-give-up behaviour, and cancel kills the
// child that call is waiting on.
//
// Not every agent has such a command. OpenCode's `opencode auth login` is an
// interactive terminal picker that asks for a provider and then an API key on
// stdin -- there is nothing Acepe can run on the operator's behalf without
// collecting their secret, which it must not do. Those agents report a
// `manual` sign-in method carrying the exact command to run, and the caller
// renders that instead of a control that cannot work.
//
// registerCustomAgent stays unsupportedOnContract in the facade -- see
// backend-client/acp.ts's header comment -- until it gets a real backend;
// it becomes a new request/result union member here, exactly like
// gitCall.ts's ops did one sub-domain at a time.

export const AgentCallAvailabilityKind = Schema.Struct({
	kind: Schema.Literal("installable"),
	installed: Schema.Boolean
})
export type AgentCallAvailabilityKind = typeof AgentCallAvailabilityKind.Type

// How this agent can be signed in, decided by the server from what the
// agent's own CLI offers. `browser` means agent.authenticate runs a real
// login command for it; `manual` means it has none Acepe can drive and
// `instructions` says what the operator should run instead. A caller renders
// a sign-in control only for `browser`.
export const AgentCallSignInMethod = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("browser") }),
	Schema.Struct({
		kind: Schema.Literal("manual"),
		instructions: Schema.String
	})
])
export type AgentCallSignInMethod = typeof AgentCallSignInMethod.Type

export const AgentCallAgentInfo = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	availabilityKind: AgentCallAvailabilityKind,
	// The registry's live signed-in reading (ProviderPresence.authenticated,
	// re-probed on every list). A hint, not a guarantee: a store the probe can
	// see may still be unreadable to a spawned session, and the runtime
	// auth_required fact (sessionAuth.ts) remains the authoritative failure
	// signal. False is what a sign-in affordance keys off.
	authenticated: Schema.Boolean,
	signIn: AgentCallSignInMethod
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

// ─── sign-in ──────────────────────────────────────────────────────────────

export const AgentCallAuthenticateRequest = Schema.Struct({
	op: Schema.Literal("agent.authenticate"),
	agentId: Schema.String
})
export type AgentCallAuthenticateRequest = typeof AgentCallAuthenticateRequest.Type

// `agents` is the agent list re-read from ProviderRegistry after the login
// command exited, the same answer agent.install carries back. Every adapter
// probes the filesystem on each presence read now (see ExecutableProbe.ts's
// bindPresence), so a credential store the login just wrote is in this
// answer; before that, presence was a snapshot taken at layer construction
// and this result had to carry nothing at all.
//
// It still reports no "authenticated" verdict of its own for the agent that
// was signed in. Read that off the agent in `agents`. A login command can
// also exit 0 having written a credential store its own adapter does not
// look in, and starting a session is what settles that case, so a caller
// that has just signed in should still reconnect and let the connection
// answer.
export const AgentCallAuthenticateResult = Schema.Struct({
	op: Schema.Literal("agent.authenticate"),
	agentId: Schema.String,
	agents: Schema.Array(AgentCallAgentInfo)
})
export type AgentCallAuthenticateResult = typeof AgentCallAuthenticateResult.Type

export const AgentCallCancelAuthenticationRequest = Schema.Struct({
	op: Schema.Literal("agent.cancel-authentication"),
	agentId: Schema.String
})
export type AgentCallCancelAuthenticationRequest =
	typeof AgentCallCancelAuthenticationRequest.Type

// `cancelled` is false when no sign-in was running for that agent, so a
// caller can tell "I stopped it" from "there was nothing to stop" instead of
// reading a success that means neither.
export const AgentCallCancelAuthenticationResult = Schema.Struct({
	op: Schema.Literal("agent.cancel-authentication"),
	agentId: Schema.String,
	cancelled: Schema.Boolean
})
export type AgentCallCancelAuthenticationResult =
	typeof AgentCallCancelAuthenticationResult.Type

// ─── preconnection model catalog ──────────────────────────────────────────

// The models an agent could run, asked BEFORE any session exists. Claude
// answers this from its SDK's initialize handshake (no prompt, no billed
// turn), so the New-chat model picker has a catalog to offer on a thread
// that has not sent anything yet. An agent whose adapter exposes no catalog
// probe answers with a typed RpcAgentCallError, and the composer falls back
// to whatever cache it holds. The entries reuse the session fact's own
// SessionModelDescriptor shape (sessionModels.ts) so the preconnection
// answer and the canonical session catalog cannot drift apart structurally.
export const AgentCallModelCatalogRequest = Schema.Struct({
	op: Schema.Literal("agent.model-catalog"),
	agentId: Schema.String
})
export type AgentCallModelCatalogRequest = typeof AgentCallModelCatalogRequest.Type

export const AgentCallModelCatalogResult = Schema.Struct({
	op: Schema.Literal("agent.model-catalog"),
	agentId: Schema.String,
	models: SessionModelCatalog
})
export type AgentCallModelCatalogResult = typeof AgentCallModelCatalogResult.Type

// ─── unions ───────────────────────────────────────────────────────────────

export const AgentCallRequest = Schema.Union([
	AgentCallListAgentsRequest,
	AgentCallInstallAgentRequest,
	AgentCallUninstallAgentRequest,
	AgentCallAuthenticateRequest,
	AgentCallCancelAuthenticationRequest,
	AgentCallModelCatalogRequest
])
export type AgentCallRequest = typeof AgentCallRequest.Type

export const AgentCallResult = Schema.Union([
	AgentCallListAgentsResult,
	AgentCallInstallAgentResult,
	AgentCallUninstallAgentResult,
	AgentCallAuthenticateResult,
	AgentCallCancelAuthenticationResult,
	AgentCallModelCatalogResult
])
export type AgentCallResult = typeof AgentCallResult.Type
