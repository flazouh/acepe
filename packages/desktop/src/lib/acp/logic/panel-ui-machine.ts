/**
 * Panel UI Machine - Simplified to focus on panel-level concerns only.
 *
 * Session state is now handled by the separate Session State Machine.
 * This machine manages:
 * - PROJECT_SELECTION: No project selected, show project picker
 * - SESSION_ACTIVE: Has an active session (session state delegated to session machine)
 * - ERROR: Panel-level errors (not session errors)
 */

import { assign, createMachine } from "xstate";

/**
 * Panel UI states - panel-level concerns only.
 */
export enum PanelUiState {
	PROJECT_SELECTION = "projectSelection", // No project selected
	SESSION_ACTIVE = "sessionActive", // Has active session (session state in session machine)
	ERROR = "error", // Panel-level error
}

/**
 * Panel UI events - panel-level events only.
 */
export enum PanelUiEvent {
	SELECT_PROJECT = "SELECT_PROJECT", // User selected a project
	SESSION_CREATED = "SESSION_CREATED", // Session successfully created
	CLEAR_SESSION = "CLEAR_SESSION", // Clear current session
	PANEL_ERROR = "PANEL_ERROR", // Panel-level error occurred
	RETRY = "RETRY", // Retry after error
	CANCEL = "CANCEL", // Cancel current operation
}

/**
 * Context data for panel UI state machine.
 */
export interface PanelUiContext {
	readonly panelId: string;
	readonly projectPath: string;
	readonly agentId: string;
	readonly sessionId: string | null;
	readonly error?: string;
}

/**
 * Input for creating a panel UI machine instance.
 */
export interface PanelUiInput {
	readonly panelId: string;
	readonly projectPath?: string;
	readonly agentId?: string;
}

/**
 * Event type definitions for the state machine.
 */
export type PanelUiEventObject =
	| {
			type: PanelUiEvent.SELECT_PROJECT;
			projectPath: string;
			agentId: string;
	  }
	| {
			type: PanelUiEvent.SESSION_CREATED;
			sessionId: string;
	  }
	| {
			type: PanelUiEvent.CLEAR_SESSION;
	  }
	| {
			type: PanelUiEvent.PANEL_ERROR;
			error: string;
	  }
	| { type: PanelUiEvent.RETRY }
	| { type: PanelUiEvent.CANCEL };

export const panelUiMachine = createMachine({
	id: "panelUi",
	types: {
		// XState requires type placeholders for inference; objectLiteralTypeAssertions disallowed by ESLint
		context: {} as PanelUiContext,
		input: {} as PanelUiInput,
		events: {} as PanelUiEventObject,
	},
	context: ({ input }) => ({
		panelId: input.panelId,
		projectPath: input.projectPath ?? "",
		agentId: input.agentId ?? "",
		sessionId: null,
	}),
	initial: PanelUiState.PROJECT_SELECTION,
	states: {
		[PanelUiState.PROJECT_SELECTION]: {
			on: {
				[PanelUiEvent.SELECT_PROJECT]: {
					target: PanelUiState.SESSION_ACTIVE,
					actions: assign({
						projectPath: ({ event }) => event.projectPath,
						agentId: ({ event }) => event.agentId,
					}),
				},
			},
		},
		[PanelUiState.SESSION_ACTIVE]: {
			on: {
				[PanelUiEvent.SESSION_CREATED]: {
					actions: assign({
						sessionId: ({ event }) => event.sessionId,
					}),
				},
				[PanelUiEvent.CLEAR_SESSION]: {
					target: PanelUiState.PROJECT_SELECTION,
					actions: assign({
						projectPath: () => "",
						agentId: () => "",
						sessionId: () => null,
						error: () => undefined,
					}),
				},
				[PanelUiEvent.PANEL_ERROR]: {
					target: PanelUiState.ERROR,
					actions: assign({
						error: ({ event }) => event.error,
					}),
				},
			},
		},
		[PanelUiState.ERROR]: {
			on: {
				[PanelUiEvent.RETRY]: {
					target: PanelUiState.PROJECT_SELECTION,
					actions: assign({
						projectPath: () => "",
						agentId: () => "",
						sessionId: () => null,
						error: () => undefined,
					}),
				},
				[PanelUiEvent.CANCEL]: {
					target: PanelUiState.PROJECT_SELECTION,
					actions: assign({
						projectPath: () => "",
						agentId: () => "",
						sessionId: () => null,
						error: () => undefined,
					}),
				},
			},
		},
	},
});
