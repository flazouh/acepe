import { type AgentCallRequest, type AgentCallResult } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { ProviderRegistry } from "./Services/ProviderRegistry.ts"

// Routes the agentCall utility RPC's tagged-union request onto the
// server's ProviderRegistry (packages/server/src/provider/Services/
// ProviderRegistry.ts), the same registry ProviderBridge resolves real
// adapters from for session.create. agent.list reads live adapter
// presence -- installed/authenticated -- straight off the registry, so
// the New-chat agent picker only ever offers agents this server can
// actually start a session with. See gitCallHandler.ts for the
// precedent this follows.
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

export const routeAgentCall = Effect.fn("routeAgentCall")(function*(request: AgentCallRequest) {
	const registry = yield* ProviderRegistry

	switch (request.op) {
		case "agent.list": {
			const presences = yield* registry.list
			const agents = presences.map((presence) => ({
				id: presence.providerId,
				name: displayNameForAgent(presence.providerId),
				availabilityKind: {
					kind: "installable" as const,
					installed: presence.installed
				}
			}))
			return { op: "agent.list", agents } as const satisfies AgentCallResult
		}
	}
})
