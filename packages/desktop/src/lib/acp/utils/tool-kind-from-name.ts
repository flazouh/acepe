import type { AgentToolKind } from "@acepe/ui/agent-panel";

/**
 * AC-280: every tool row (both the scaffold's agent-panel-tool-row.ts and
 * the live transcript viewport's transcript-viewport-row-mapper.ts) landed
 * every tool call in AgentToolKind "unclassified" -- there was nothing that
 * turned the provider's own tool name ("Write", "Read", "Bash", ...) into a
 * kind, so tool-kind-icon-model.ts's unclassified -> "question" mapping
 * fired for every row: Write, Read, Bash, Grep, all showed the generic "?"
 * icon even though the correct icons (tool-edit, tool-read, terminal,
 * tool-search, ...) already exist in that same map.
 *
 * Mirrors the server's detectClaudeToolKind (Claude/Tools.ts) folding
 * convention (Write/MultiEdit/NotebookEdit collapse into "edit", the same
 * way the server's own permission title/path-hint logic already treats
 * them) so a tool call classifies the same way on both sides -- but this
 * mapper's job is purely presentational (which icon a row gets), not
 * provenance, so it stays provider-agnostic: Codex/OpenCode tool names are
 * covered where their shape is the same as Claude's (Bash, Read, Grep,
 * Glob, ...) and anything genuinely unrecognized falls back to
 * "unclassified" honestly, not to a guessed kind.
 *
 * This is a client-side inference because the canonical ToolCallObserved
 * contract event carries only {activityId, toolCallId, status, title,
 * path} -- no kind field -- even though the server already computes one
 * (ClaudeAcpToolKind) to build the title/path hints, then discards it. The
 * cleaner fix is widening that contract event to carry the server's own
 * classification instead of re-deriving a weaker one from the display
 * title client-side; out of scope here (touches packages/contracts and
 * every provider's Session.ts), so this mapper is the client-side stopgap
 * the icon actually needs today.
 */
const foldToolName = (name: string): string =>
	name
		.trim()
		.toLowerCase()
		.replace(/[\s_-]/g, "");

export function toolKindFromProviderName(name: string): AgentToolKind {
	const folded = foldToolName(name);

	if (
		folded === "read" ||
		folded === "readfile" ||
		folded === "view" ||
		folded === "notebookread"
	) {
		return "read";
	}
	if (folded === "readlints") {
		return "read_lints";
	}
	if (
		folded === "bash" ||
		folded === "execute" ||
		folded === "shell" ||
		folded === "run" ||
		folded === "terminal" ||
		folded === "killshell" ||
		folded === "killbash"
	) {
		return "execute";
	}
	// AgentToolKind carries "write" as its own literal, distinct from "edit"
	// (same "tool-edit" icon, per tool-kind-icon-model.ts, but a more
	// specific title -- defaultViewportToolTitle maps it to "Write" rather
	// than the generic "Edit"), so a create-a-new-file tool keeps its own
	// verb instead of folding into "edit" the way the server's
	// detectClaudeToolKind does for permission-title purposes.
	if (folded === "write" || folded === "writefile") {
		return "write";
	}
	if (
		folded === "edit" ||
		folded === "editfile" ||
		folded === "notebookedit" ||
		folded === "multiedit" ||
		folded === "strreplace" ||
		folded === "strreplaceeditor" ||
		folded === "applypatch"
	) {
		return "edit";
	}
	if (folded === "delete" || folded === "deletefile" || folded === "rm") {
		return "delete";
	}
	if (folded === "glob" || folded === "ls" || folded === "grep" || folded === "search") {
		return "search";
	}
	if (folded === "webfetch" || folded === "fetch") {
		return "fetch";
	}
	if (folded === "websearch") {
		return "web_search";
	}
	if (folded === "think" || folded === "thinking") {
		return "think";
	}
	if (folded === "task" || folded === "taskcreate" || folded === "taskupdate") {
		return "task";
	}
	if (folded === "skill") {
		return "skill";
	}
	if (folded === "enterplanmode") {
		return "enter_plan_mode";
	}
	if (folded === "exitplanmode") {
		return "exit_plan_mode";
	}
	// Honest fallback: TodoWrite/TodoRead, AskUserQuestion, raw MCP tool
	// names ("mcp__server__DoThing"), and anything else genuinely
	// unrecognized. No AgentToolKind fits these well enough to guess one --
	// "unclassified" keeps the "?" icon, which is the truthful answer, not
	// a default applied to everything.
	return "unclassified";
}

/**
 * Same classification, from a server-formatted display title
 * ("Read AGENTS.md", "Write /tmp/a.txt") instead of the bare provider tool
 * name -- the shape `toolCallTitle` (server's Claude/Tools.ts) and its
 * Codex/Cursor/OpenCode equivalents already produce for
 * RpcProjectedSessionActivity.title: `${name} ${hint}` for every kind
 * except "execute", which is the hint alone (the raw shell command, e.g.
 * "ls -la", carries no verb to extract). That one category still falls
 * back to "unclassified" here rather than misreading a command's first
 * word as a tool name -- an honest gap, not a guess.
 */
export function toolKindFromTitle(title: string): AgentToolKind {
	const firstWord = title.trim().split(/\s+/u)[0];
	return firstWord === undefined ? "unclassified" : toolKindFromProviderName(firstWord);
}
