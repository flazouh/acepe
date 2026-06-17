/**
 * Panel connection state management types.
 *
 * Defines enums and types for managing panel connection lifecycle
 * using XState state machine.
 */

import type { FailureReason } from "$lib/services/acp-types.js";

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

export interface PanelConnectionErrorDetails {
	readonly message: string;
	readonly referenceId?: string;
	readonly referenceSearchable?: boolean;
	/**
	 * Canonical lifecycle classification when this panel-level error carries one
	 * (e.g. a pre-session creation failure that resolved to
	 * `authenticationRequired`). Lets the panel render the same curated,
	 * lifecycle-driven card the resume path produces, instead of the raw
	 * creation message. `undefined`/`null` for unclassified panel errors.
	 */
	readonly failureReason?: FailureReason | null;
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
	error?: PanelConnectionErrorDetails;
	startedAt?: Date;
}
