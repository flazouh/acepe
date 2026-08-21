import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import { isCapabilityEnabled } from "../Services/ProviderAdapter.ts"
import {
	COPILOT_ACP_STDIO_ARGS,
	COPILOT_CAPABILITIES,
	COPILOT_LOGIN_METHOD_ID,
	COPILOT_MODES,
	COPILOT_PROVIDER_ID,
	COPILOT_SESSION_MCP_SERVERS,
	COPILOT_TRANSPORT,
	copilotAuthenticateParams,
	copilotPresence,
	copilotSessionNewParams,
	isCopilotPlanCapabilityEnabled,
	mapOutboundCopilotModeId,
	normalizeCopilotModeId
} from "./CopilotProvider.ts"

Vitest.describe("CopilotProvider", () => {
	Vitest.it("uses the copilot provider id and ACP stdio transport", () => {
		Vitest.assert.strictEqual(COPILOT_PROVIDER_ID, "copilot")
		Vitest.assert.strictEqual(COPILOT_TRANSPORT, "acp")
		Vitest.assert.deepStrictEqual(COPILOT_ACP_STDIO_ARGS, ["--acp", "--stdio"])
	})

	Vitest.it("enables models, modes, plan, usage, tools, and permissions without compaction", () => {
		Vitest.assert.deepStrictEqual(COPILOT_CAPABILITIES.enabled, [
			"models",
			"modes",
			"commands",
			"configOptions",
			"autonomous",
			"plan",
			"usage",
			"toolCalls",
			"permissionRequests"
		])
		Vitest.assert.strictEqual(isCapabilityEnabled(COPILOT_CAPABILITIES, "plan"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(COPILOT_CAPABILITIES, "autonomous"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(COPILOT_CAPABILITIES, "compaction"), false)
		Vitest.assert.strictEqual(isCopilotPlanCapabilityEnabled(), true)
	})

	Vitest.it("keeps MCP servers empty on session/new, matching today's ACP client", () => {
		Vitest.assert.deepStrictEqual(COPILOT_SESSION_MCP_SERVERS, Arr.empty())
		Vitest.assert.deepStrictEqual(copilotSessionNewParams("/tmp/acepe"), {
			cwd: "/tmp/acepe",
			mcpServers: Arr.empty()
		})
	})

	Vitest.it("normalizes Copilot mode URIs and maps outbound ids back to ACP URIs", () => {
		Vitest.assert.deepStrictEqual(COPILOT_MODES, ["agent", "autopilot", "plan"])
		Vitest.assert.strictEqual(
			normalizeCopilotModeId("https://agentclientprotocol.com/protocol/session-modes#agent"),
			"agent"
		)
		Vitest.assert.strictEqual(
			normalizeCopilotModeId("https://github.com/github/copilot-cli/mode#plan"),
			"plan"
		)
		Vitest.assert.strictEqual(normalizeCopilotModeId("build"), "agent")
		Vitest.assert.strictEqual(
			mapOutboundCopilotModeId("agent"),
			"https://agentclientprotocol.com/protocol/session-modes#agent"
		)
		Vitest.assert.strictEqual(
			mapOutboundCopilotModeId("autopilot"),
			"https://agentclientprotocol.com/protocol/session-modes#autopilot"
		)
		Vitest.assert.strictEqual(
			mapOutboundCopilotModeId("plan"),
			"https://agentclientprotocol.com/protocol/session-modes#plan"
		)
	})

	Vitest.it("authenticates with copilot-login and reports presence without process.env", () => {
		Vitest.assert.strictEqual(COPILOT_LOGIN_METHOD_ID, "copilot-login")
		Vitest.assert.deepStrictEqual(copilotAuthenticateParams, {
			methodId: "copilot-login"
		})
		const presence = copilotPresence(true, false)
		Vitest.assert.strictEqual(presence.providerId, COPILOT_PROVIDER_ID)
		Vitest.assert.strictEqual(presence.installed, true)
		Vitest.assert.strictEqual(presence.authenticated, false)
	})
})
