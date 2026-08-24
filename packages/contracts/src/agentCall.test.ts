import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { AgentCallAgentInfo, AgentCallRequest, AgentCallResult } from "./agentCall.ts"

describe("AgentCallRequest", () => {
	it("decodes agent.list by its op discriminant", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.list" }))
		expect(decoded).toEqual({ op: "agent.list" })
	})

	it("rejects an unknown op", () => {
		const outcome = Effect.runSyncExit(
			Schema.decodeUnknownEffect(AgentCallRequest)({ op: "agent.install" })
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
						availabilityKind: { kind: "installable", installed: true }
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
					availabilityKind: { kind: "installable", installed: true }
				}
			]
		})
	})

	it("decodes an empty agent list", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(AgentCallResult)({ op: "agent.list", agents: [] })
		)
		expect(decoded.agents).toEqual([])
	})
})

describe("AgentCallAgentInfo", () => {
	it("rejects a missing name", () => {
		const outcome = Effect.runSyncExit(
			Schema.decodeUnknownEffect(AgentCallAgentInfo)({
				id: "claude-code",
				availabilityKind: { kind: "installable", installed: true }
			})
		)
		expect(outcome._tag).toBe("Failure")
	})
})
