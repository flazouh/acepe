import { describe, expect, it } from "vitest"
import { signInMethodForAgent, signInPlanForAgent } from "./signIn.ts"

describe("signInPlanForAgent", () => {
	it("gives every agent whose CLI has a browser login a command to run", () => {
		expect(signInPlanForAgent("claude-code")).toMatchObject({
			kind: "browser",
			binaryName: "claude",
			args: ["auth", "login"]
		})
		expect(signInPlanForAgent("codex")).toMatchObject({
			kind: "browser",
			binaryName: "codex",
			args: ["login"]
		})
		expect(signInPlanForAgent("copilot")).toMatchObject({
			kind: "browser",
			binaryName: "copilot",
			args: ["login", "--web-flow"]
		})
		expect(signInPlanForAgent("cursor")).toMatchObject({
			kind: "browser",
			binaryName: "cursor-agent",
			args: ["login"]
		})
	})

	// The device-code flows print a one-time code Acepe would have to relay,
	// which is the one thing this lane refuses to do. If a flag like this
	// appears in a plan, the plan is asking Acepe to handle a credential.
	it("never asks a CLI for a device-code flow", () => {
		for (const agentId of ["claude-code", "codex", "copilot", "cursor"]) {
			const plan = signInPlanForAgent(agentId)
			expect(plan.kind).toBe("browser")
			if (plan.kind === "browser") {
				expect(plan.args.join(" ")).not.toContain("device")
			}
		}
	})

	it("reports opencode as manual, naming the command to run instead", () => {
		const plan = signInPlanForAgent("opencode")
		expect(plan.kind).toBe("manual")
		if (plan.kind === "manual") {
			expect(plan.instructions).toContain("opencode auth login")
		}
	})

	it("reports an agent it does not know as manual rather than guessing a command", () => {
		const plan = signInPlanForAgent("something-new")
		expect(plan.kind).toBe("manual")
		if (plan.kind === "manual") {
			expect(plan.instructions).toContain("something-new")
		}
	})
})

describe("signInMethodForAgent", () => {
	it("keeps the binary and args off the wire", () => {
		expect(signInMethodForAgent("codex")).toEqual({ kind: "browser" })
	})

	it("carries the manual instructions onto the wire", () => {
		expect(signInMethodForAgent("opencode")).toMatchObject({ kind: "manual" })
	})
})
