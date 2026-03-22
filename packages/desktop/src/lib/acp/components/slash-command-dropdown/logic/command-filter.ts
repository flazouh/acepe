import type { AvailableCommand } from "../../../types/available-command.js";

/**
 * Filter commands based on query string.
 *
 * Filters commands by matching the query against the command name (case-insensitive).
 * If query is empty, returns all commands.
 *
 * @param commands - Available commands to filter
 * @param query - Query string to filter by
 * @returns Filtered commands
 *
 * @example
 * ```ts
 * const commands = [
 *   { name: "test", description: "Run tests" },
 *   { name: "review", description: "Review code" }
 * ];
 * const filtered = filterCommands(commands, "test");
 * // Returns: [{ name: "test", description: "Run tests" }]
 * ```
 */
export function filterCommands(
	commands: ReadonlyArray<AvailableCommand>,
	query: string
): AvailableCommand[] {
	// Treat empty or whitespace-only query as no filter
	if (!query || !query.trim()) {
		return [...commands];
	}

	const lowerQuery = query.toLowerCase().trim();
	return commands.filter((cmd) => cmd.name.toLowerCase().includes(lowerQuery));
}
