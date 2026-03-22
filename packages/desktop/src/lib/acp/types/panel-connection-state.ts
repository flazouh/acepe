/**
 * Panel connection state management types.
 *
 * Defines enums and types for managing panel connection lifecycle
 * using XState state machine.
 */

export enum PanelConnectionState {
	IDLE = "idle",
	CONNECTING = "connecting",
	CONNECTED = "connected",
	ERROR = "error",
}

export enum PanelConnectionEvent {
	START_CONNECTION = "START_CONNECTION",
	CONNECTION_SUCCESS = "CONNECTION_SUCCESS",
	CONNECTION_ERROR = "CONNECTION_ERROR",
	RETRY = "RETRY",
	CANCEL = "CANCEL",
}

/**
 * Context data for panel connection state machine.
 */
export interface PanelConnectionContext {
	panelId: string;
	projectPath: string;
	agentId: string;
	title?: string;
	sessionId: string | null;
	error?: string;
	startedAt?: Date;
}
