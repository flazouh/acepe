import { type McpServerConfig, type Options as ClaudeSdkOptions } from "@anthropic-ai/claude-agent-sdk"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { decodeJsonObject, EMPTY_JSON_OBJECT, type JsonObject } from "../Json.ts"
import { CLAUDE_ISOLATED_SETTING_SOURCES, CLAUDE_STRICT_MCP_CONFIG } from "./Provider.ts"

export type ClaudePermissionResult =
	| {
			readonly behavior: "allow"
			readonly updatedInput: JsonObject
	  }
	| {
			readonly behavior: "deny"
			readonly message: string
	  }

export type ClaudeCanUseTool = (
	toolName: string,
	input: JsonObject,
	options: { readonly toolUseID: string }
) => Promise<ClaudePermissionResult>

export type ClaudeUserPrompt = {
	readonly type: "user"
	readonly session_id: string
	readonly parent_tool_use_id: null
	readonly message: {
		readonly role: "user"
		readonly content: string
	}
}

const jsonObjectFromValue = <A>(value: A): JsonObject => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return exit.value
	}
	return EMPTY_JSON_OBJECT
}

export const userPrompt = (
	text: string,
	providerSessionId: Option.Option<string>
): ClaudeUserPrompt => ({
	type: "user",
	session_id: Option.getOrElse(providerSessionId, () => ""),
	parent_tool_use_id: null,
	message: {
		role: "user",
		content: text
	}
})

export type ClaudeQueryIsolation = {
	// When given, points query() at a system claude binary instead of the
	// SDK's own bundled native CLI (an optional platform dependency a
	// bundler's static analysis can't see and drops) — see
	// resolveClaudeExecutablePath in Provider.ts for why this exists.
	readonly pathToClaudeCodeExecutable: Option.Option<string>
	// MCP servers Acepe itself wires in for this session, distinct from (and
	// never merged with) the operator's personal ~/.claude.json servers —
	// see CLAUDE_SESSION_MCP_SERVERS in Provider.ts.
	readonly mcpServers: Record<string, McpServerConfig>
}

// Builds the exact options object passed to the SDK's query(). Pulled out as
// a pure function (no SDK call, no process spawn) so the isolation settings
// can be unit-tested directly instead of only through a live spawn.
//
// settingSources excludes the operator's 'user'-scoped config
// (~/.claude/settings.json — hooks) while keeping 'project'/'local' (the
// target repo's own CLAUDE.md / .claude/settings.json, legitimate task
// context). strictMcpConfig + the explicit mcpServers below stop the
// operator's ~/.claude.json personal MCP servers (a railway server, a
// personal-memory venv server, ...) from being inherited. Both settings were
// verified empirically against the real SDK: the defaults (neither set)
// spawn the operator's personal MCP server child processes on the first
// turn; either setting alone, and the combination, block that spawn while
// still returning a real reply. See CLAUDE_ISOLATED_SETTING_SOURCES and
// CLAUDE_STRICT_MCP_CONFIG in Provider.ts for the fuller rationale.
export const buildClaudeQueryOptions = (
	input: {
		readonly cwd: string
		readonly canUseTool: ClaudeCanUseTool
		readonly resume?: Option.Option<string>
	},
	isolation: ClaudeQueryIsolation
): ClaudeSdkOptions => ({
	cwd: input.cwd,
	includePartialMessages: true,
	settingSources: [...CLAUDE_ISOLATED_SETTING_SOURCES],
	strictMcpConfig: CLAUDE_STRICT_MCP_CONFIG,
	mcpServers: isolation.mcpServers,
	...(Option.isSome(isolation.pathToClaudeCodeExecutable)
		? { pathToClaudeCodeExecutable: isolation.pathToClaudeCodeExecutable.value }
		: {}),
	...(input.resume !== undefined && Option.isSome(input.resume)
		? { resume: input.resume.value }
		: {}),
	canUseTool: (toolName, toolInput, options) =>
		input.canUseTool(toolName, jsonObjectFromValue(toolInput), {
			toolUseID: options.toolUseID
		})
})
