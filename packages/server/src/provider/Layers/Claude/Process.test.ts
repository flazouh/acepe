import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { buildClaudeQueryOptions } from "./Process.ts"

// These pin down the isolation fix's actual mechanism: the SDK's query()
// options constructed for a live session must exclude the operator's
// personal ~/.claude config while keeping the target repo's own project
// settings — see buildClaudeQueryOptions' doc comment in Adapter.ts
// for the empirical evidence behind these exact values.
Vitest.describe("buildClaudeQueryOptions", () => {
	const fakeCanUseTool = (() =>
		Promise.resolve({ behavior: "deny" as const, message: "unused in these tests" }))

	Vitest.it("excludes the operator's 'user' setting source, keeping 'project' and 'local'", () => {
		const options = buildClaudeQueryOptions(
			{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
			{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
		)
		Vitest.assert.deepStrictEqual(options.settingSources, ["project", "local"])
	})

	Vitest.it("sets strictMcpConfig so operator MCP servers are never inherited", () => {
		const options = buildClaudeQueryOptions(
			{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
			{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
		)
		Vitest.assert.strictEqual(options.strictMcpConfig, true)
	})

	Vitest.it("threads through Acepe's own mcpServers (not the operator's)", () => {
		const appConfiguredServers = {
			"acepe-tool": { command: "node", args: ["./acepe-mcp.js"] }
		}
		const options = buildClaudeQueryOptions(
			{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
			{ pathToClaudeCodeExecutable: Option.none(), mcpServers: appConfiguredServers }
		)
		Vitest.assert.deepStrictEqual(options.mcpServers, appConfiguredServers)
	})

	Vitest.it("omits pathToClaudeCodeExecutable when none is resolved", () => {
		const options = buildClaudeQueryOptions(
			{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
			{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
		)
		Vitest.assert.isUndefined(options.pathToClaudeCodeExecutable)
	})

	Vitest.it("includes pathToClaudeCodeExecutable when resolved", () => {
		const options = buildClaudeQueryOptions(
			{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
			{ pathToClaudeCodeExecutable: Option.some("/usr/local/bin/claude"), mcpServers: {} }
		)
		Vitest.assert.strictEqual(options.pathToClaudeCodeExecutable, "/usr/local/bin/claude")
	})

	Vitest.it("keeps cwd and partial-message streaming", () => {
		const options = buildClaudeQueryOptions(
			{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
			{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
		)
		Vitest.assert.strictEqual(options.cwd, "/workspace/repo")
		Vitest.assert.strictEqual(options.includePartialMessages, true)
	})
})
