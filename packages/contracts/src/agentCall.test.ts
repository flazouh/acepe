import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { AgentCallAgentInfo, AgentCallRequest, AgentCallResult } from "./agentCall.ts"

describe("AgentCallRequest", () => {
	it("decodes agent.list by its op discriminant", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.list" }))
		expect(decoded).toEqual({ op: "agent.list" })
	})

	it("decodes agent.install with the agent it names", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.install", agentId: "opencode" })
		)
		expect(decoded).toEqual({ op: "agent.install", agentId: "opencode" })
	})

	it("decodes agent.uninstall with the agent it names", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.uninstall", agentId: "opencode" })
		)
		expect(decoded).toEqual({ op: "agent.uninstall", agentId: "opencode" })
	})

	it("rejects agent.install without an agentId", () => {
		const outcome = Effect.runSyncExit(
			Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.install" })
		)
		expect(outcome._tag).toBe("Failure")
	})

	it("decodes agent.authenticate with the agent it names", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.authenticate", agentId: "codex" })
		)
		expect(decoded).toEqual({ op: "agent.authenticate", agentId: "codex" })
	})

	it("decodes agent.cancel-authentication with the agent it names", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallRequest)({
				op: "agent.cancel-authentication",
				agentId: "codex"
			})
		)
		expect(decoded).toEqual({ op: "agent.cancel-authentication", agentId: "codex" })
	})

	it("rejects an agent.authenticate without an agentId", () => {
		const outcome = Effect.runSyncExit(
			Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.authenticate" })
		)
		expect(outcome._tag).toBe("Failure")
	})

	it("rejects an unknown op", () => {
		const outcome = Effect.runSyncExit(
			Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.teleport" })
		)
		expect(outcome._tag).toBe("Failure")
	})
})

describe("AgentCallResult", () => {
	it("decodes an agent.list result carrying an installed agent", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallResult)({
				op: "agent.list",
				agents: [
					{
						id: "claude-code",
						name: "Claude Code",
						availabilityKind: { kind: "installable", installed: true },
						signIn: { kind: "browser" as const }
					}
				]
			})
		)
		expect(decoded).toEqual({
			op: "agent.list",
			agents: [
				{
					id: "claude-code",
					name: "Claude Code",
					availabilityKind: { kind: "installable", installed: true },
					signIn: { kind: "browser" as const }
				}
			]
		})
	})

	it("decodes an agent.install result carrying the installed version and the refreshed list", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallResult)({
				op: "agent.install",
				agentId: "opencode",
				version: "1.18.25",
				agents: [
					{
						id: "opencode",
						name: "OpenCode",
						availabilityKind: { kind: "installable", installed: true },
						signIn: { kind: "browser" as const }
					}
				]
			})
		)
		expect(decoded).toEqual({
			op: "agent.install",
			agentId: "opencode",
			version: "1.18.25",
			agents: [
				{
					id: "opencode",
					name: "OpenCode",
					availabilityKind: { kind: "installable", installed: true },
					signIn: { kind: "browser" as const }
				}
			]
		})
	})

	it("decodes an agent.uninstall result carrying the refreshed list", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallResult)({
				op: "agent.uninstall",
				agentId: "opencode",
				agents: []
			})
		)
		expect(decoded).toEqual({ op: "agent.uninstall", agentId: "opencode", agents: [] })
	})

	it("decodes an empty agent list", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallResult)({ op: "agent.list", agents: [] })
		)
		expect(decoded).toEqual({ op: "agent.list", agents: [] })
	})

	// The list is read after the login command exited, which is what the
	// result buys a caller -- see the type's own comment.
	it("decodes an agent.authenticate result carrying the refreshed list", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallResult)({
				op: "agent.authenticate",
				agentId: "codex",
				agents: []
			})
		)
		expect(decoded).toEqual({ op: "agent.authenticate", agentId: "codex", agents: [] })
	})

	it("decodes an agent.cancel-authentication result carrying whether it stopped one", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallResult)({
				op: "agent.cancel-authentication",
				agentId: "codex",
				cancelled: false
			})
		)
		expect(decoded).toEqual({
			op: "agent.cancel-authentication",
			agentId: "codex",
			cancelled: false
		})
	})
})

describe("AgentCallAgentInfo", () => {
	it("rejects a missing name", () => {
		const outcome = Effect.runSyncExit(
			Schema.decodeUnknownEffect(AgentCallAgentInfo)({
				id: "claude-code",
				availabilityKind: { kind: "installable", installed: true },
				signIn: { kind: "browser" }
			})
		)
		expect(outcome._tag).toBe("Failure")
	})

	// A caller decides whether to render a sign-in control from this, so a
	// manual method has to carry the copy that replaces the control.
	it("rejects a manual sign-in method with no instructions", () => {
		const outcome = Effect.runSyncExit(
			Schema.decodeUnknownEffect(AgentCallAgentInfo)({
				id: "opencode",
				name: "OpenCode",
				availabilityKind: { kind: "installable", installed: true },
				signIn: { kind: "manual" }
			})
		)
		expect(outcome._tag).toBe("Failure")
	})
})
