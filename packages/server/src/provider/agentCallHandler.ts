import {
	type AgentCallAgentInfo,
	type AgentCallRequest,
	type AgentCallResult,
	RpcAgentCallError
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { AgentAuthenticator } from "./Services/AgentAuthenticator.ts"
import { AgentInstaller } from "./Services/AgentInstaller.ts"
import { decodeProviderId } from "./Services/ProviderAdapter.ts"
import { ProviderRegistry } from "./Services/ProviderRegistry.ts"
import { signInMethodForAgent } from "./signIn.ts"

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
// authenticate and cancel-authentication run AgentAuthenticator (packages/
// server/src/provider/Layers/AgentAuthenticator.ts), which spawns the
// agent's own login command and waits for it. They are on this lane for the
// same reason install is: the orchestration `agent.authenticate` command is
// an echo that records "signed in" without a credential having been
// exchanged, and authenticatedness is answered by ProviderRegistry presence.
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
		},
		// Server-decided, from what the agent's own CLI offers -- see
		// provider/signIn.ts. A caller renders a sign-in control from this
		// rather than deciding for itself which agents have one.
		signIn: signInMethodForAgent(presence.providerId)
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
			// decode, not ProviderId.make: `make` throws on an empty or
			// untrimmed id, and a throw inside Effect.fn is a defect. A caller
			// that names a nonsense agent gets the same typed
			// RpcAgentCallError every other bad install answers with.
			const agentId = yield* decodeProviderId(request.agentId).pipe(
				Effect.mapError(toRpcAgentCallError(request.op))
			)
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
		case "agent.authenticate": {
			const authenticator = yield* AgentAuthenticator
			const agentId = yield* decodeProviderId(request.agentId).pipe(
				Effect.mapError(toRpcAgentCallError(request.op))
			)
			// Long-running: it is waiting on the person finishing the login
			// in their browser. Cancelling is agent.cancel-authentication,
			// which stops the child this call is waiting on and makes this
			// call fail with the cancelled message.
			//
			// Succeeding means the login command exited cleanly. It does not
			// claim the agent is now authenticated -- see the result type in
			// packages/contracts/src/agentCall.ts for why this lane cannot
			// answer that and who can.
			yield* authenticator.signIn(agentId).pipe(Effect.mapError(toRpcAgentCallError(request.op)))
			return {
				op: "agent.authenticate",
				agentId: request.agentId
			} as const satisfies AgentCallResult
		}
		case "agent.cancel-authentication": {
			const authenticator = yield* AgentAuthenticator
			const agentId = yield* decodeProviderId(request.agentId).pipe(
				Effect.mapError(toRpcAgentCallError(request.op))
			)
			const cancelled = yield* authenticator.cancel(agentId)
			return {
				op: "agent.cancel-authentication",
				agentId: request.agentId,
				cancelled
			} as const satisfies AgentCallResult
		}
		case "agent.uninstall": {
			const installer = yield* AgentInstaller
			const agentId = yield* decodeProviderId(request.agentId).pipe(
				Effect.mapError(toRpcAgentCallError(request.op))
			)
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
