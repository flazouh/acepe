import type { ToolArguments } from "../../../../../services/converted-session-types.js";

/**
 * Resolve the command string for an execute tool call from multiple sources.
 *
 * Priority:
 * 1. Streaming arguments (progressive display while tool runs)
 * 2. Typed tool arguments (enriched by router with permission rawInput)
 * 3. Backtick-wrapped title (last resort, e.g. "`cd /path && cargo test`")
 */
export function resolveExecuteCommand(
	streamingArgs: ToolArguments | null | undefined,
	typedArgs: ToolArguments,
	title: string | null | undefined
): string | null {
	// 1. Streaming arguments (progressive display)
	if (streamingArgs?.kind === "execute" && streamingArgs.command) {
		return streamingArgs.command;
	}

	// 2. Typed arguments from the tool call
	if (typedArgs.kind === "execute" && typedArgs.command) {
		return typedArgs.command;
	}

	// 3. Backtick-wrapped title
	if (title) {
		const match = title.match(/^`(.+)`$/);
		if (match) return match[1];
	}

	return null;
}
