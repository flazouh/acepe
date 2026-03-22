import type { TerminalEnvVariable } from "./terminal-env-variable.js";

/**
 * Parameters for creating a new terminal (terminal/create request).
 */
export interface CreateTerminalParams {
	sessionId: string;
	command: string;
	args?: string[];
	cwd?: string;
	env?: TerminalEnvVariable[];
	outputByteLimit?: number;
}
