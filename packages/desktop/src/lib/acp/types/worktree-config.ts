/**
 * Worktree configuration from .acepe.json
 */
export interface WorktreeConfig {
	readonly setupScript: string;
}

/**
 * Output from a single setup command
 */
export interface CommandOutput {
	readonly command: string;
	readonly success: boolean;
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | null;
}

/**
 * Result of running worktree setup commands
 */
export interface SetupResult {
	readonly success: boolean;
	readonly commandsRun: number;
	readonly error: string | null;
	readonly output: CommandOutput[];
}
