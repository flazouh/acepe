import {
	type AgentCallAgentInfo,
	type AgentCallRequest,
	type AgentCallResult,
	RpcAgentCallError
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { AgentInstaller } from "./Services/AgentInstaller.ts"
import { ProviderId } from "./Services/ProviderAdapter.ts"
import { ProviderRegistry } from "./Services/ProviderRegistry.ts"

// Routes the agentCall utility RPC's tagged-union request onto the
// server's ProviderRegistry (packages/server/src/provider/Services/
// ProviderRegistry.ts), the same registry ProviderBridge resolves real
// adapters from for session.create, and onto AgentInstaller (packages/
// server/src/provider/Layers/AgentInstaller.ts) for the two ops that
// change what is installed. agent.list reads live adapter presence --
// installed/authenticated -- straight off the registry, so the New-chat
// agent picker only ever offers agents this server can actually start a
// session with. See gitCallHandler.ts for the precedent this follows.
//
// install and uninstall answer with that same list, re-read after the
// installer ran. The registry stays the single authority on whether an
// agent is installed: this handler never asserts an outcome of its own,
// and no caller has to keep a client-side installed-set. See
// packages/contracts/src/agentCall.ts for why this lane carries install
// rather than the orchestration `agent.install` command.
//
// Display names are a presentation label, not canonical data: they
// follow the same per-provider-id literal precedent as
// providerUsage/usageMapping.ts's unavailableProvider() call sites
// rather than adding a new canonical field to ProviderAdapter/
// ProviderPresence for a single cosmetic string.
const AGENT_DISPLAY_NAMES: Record<string, string> = {
	"claude-code": "Claude Code",
	"codex": "Codex",
	"opencode": "OpenCode",
	"cursor": "Cursor",
	"copilot": "Copilot"
}

const displayNameForAgent = (providerId: string): string =>
	AGENT_DISPLAY_NAMES[providerId] ?? providerId

const toRpcAgentCallError = (op: string) => (error: { readonly message: string }): RpcAgentCallError =>
	new RpcAgentCallError({ op, detail: error.message })

const listAgents = Effect.fn("agentCall.listAgents")(function*() {
	const registry = yield* ProviderRegistry
	const presences = yield* registry.list
	// Annotated with the contract type on purpose: ProviderId is branded
	// inside the server, and the wire carries a plain string.
	const agents: ReadonlyArray<AgentCallAgentInfo> = presences.map((presence) => ({
		id: presence.providerId,
		name: displayNameForAgent(presence.providerId),
		availabilityKind: {
			kind: "installable" as const,
			installed: presence.installed
		}
	}))
	return agents
})

export const routeAgentCall = Effect.fn("routeAgentCall")(function*(request: AgentCallRequest) {
	switch (request.op) {
		case "agent.list": {
			const agents = yield* listAgents()
			return { op: "agent.list", agents } as const satisfies AgentCallResult
		}
		case "agent.install": {
			const installer = yield* AgentInstaller
			const agentId = ProviderId.make(request.agentId)
			// ensureLatest, not install: the picker's control is idempotent.
			// An agent already at the registry's version stays where it is,
			// and a stale one is replaced, which is what "Install" has to
			// mean for a control the operator can press twice.
			const outcome = yield* installer
				.ensureLatest(agentId)
				.pipe(Effect.mapError(toRpcAgentCallError(request.op)))
			const agents = yield* listAgents()
			return {
				op: "agent.install",
				agentId: request.agentId,
				version: outcome.agent.version,
				agents
			} as const satisfies AgentCallResult
		}
		case "agent.uninstall": {
			const installer = yield* AgentInstaller
			const agentId = ProviderId.make(request.agentId)
			yield* installer.uninstall(agentId).pipe(Effect.mapError(toRpcAgentCallError(request.op)))
			const agents = yield* listAgents()
			return {
				op: "agent.uninstall",
				agentId: request.agentId,
				agents
			} as const satisfies AgentCallResult
		}
	}
})
