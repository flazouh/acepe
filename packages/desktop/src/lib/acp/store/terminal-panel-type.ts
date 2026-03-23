/**
 * Terminal panel for interactive shell sessions.
 */
export interface TerminalPanel {
	/** Unique panel identifier */
	id: string;

	/** Absolute path to the project root (working directory) */
	projectPath: string;

	/** Panel width in pixels */
	width: number;

	/** PTY session ID (from tauri-pty) */
	ptyId: number | null;

	/** Shell process being used (e.g., /bin/zsh) */
	shell: string | null;
}

export const DEFAULT_TERMINAL_PANEL_WIDTH = 500;
export const MIN_TERMINAL_PANEL_WIDTH = 300;
