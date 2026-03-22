/**
 * Common parameters for terminal requests (output, wait_for_exit, kill, release).
 */
export interface TerminalRequestParams {
	sessionId: string;
	terminalId: string;
}
