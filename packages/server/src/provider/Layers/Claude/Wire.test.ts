import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { buildClaudeQueryOptions } from "./Wire.ts"

// These pin down the isolation fix's actual mechanism: the SDK's query()
// options constructed for a live session must exclude the operator's
// personal ~/.claude config while keeping the target repo's own project
// settings — see buildClaudeQueryOptions' doc comment in Wire.ts
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

	// The session's mode belongs in the LAUNCH options, not only in the live
	// setPermissionMode control request: a replacement query (a cancel, a
	// watchdog stall recovery) would otherwise start in the SDK's default
	// mode and silently undo a set mode. See attachQuery in Adapter.ts.
	Vitest.it("launches the query in the session's own mode", () => {
		const options = buildClaudeQueryOptions(
			{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool, permissionMode: "plan" },
			{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
		)
		Vitest.assert.strictEqual(options.permissionMode, "plan")
	})

	Vitest.it("launches in Claude's default mode when no mode is given", () => {
		const options = buildClaudeQueryOptions(
			{ cwd: "/workspace/repo", canUseTool: fakeCanUseTool },
			{ pathToClaudeCodeExecutable: Option.none(), mcpServers: {} }
		)
		Vitest.assert.strictEqual(options.permissionMode, "default")
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
