import type { TerminalExitStatus } from "./terminal-exit-status.js";

/**
 * Result from terminal/output.
 */
export interface TerminalOutputResult {
	output: string;
	truncated: boolean;
	exitStatus?: TerminalExitStatus;
}
