/**
 * Error types for command palette operations.
 */
export class CommandPaletteError extends Error {
	constructor(
		message: string,
		public readonly code: CommandPaletteErrorCode
	) {
		super(message);
		this.name = "CommandPaletteError";
	}
}

/**
 * Error codes for command palette operations.
 */
export type CommandPaletteErrorCode =
	| "COMMAND_NOT_FOUND"
	| "COMMAND_EXECUTION_FAILED"
	| "INVALID_STATE";
