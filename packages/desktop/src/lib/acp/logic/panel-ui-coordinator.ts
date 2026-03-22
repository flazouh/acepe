/**
 * Panel UI Coordinator - Simplified coordination with session machine.
 *
 * Since session state is now handled by the Session State Machine,
 * this coordinator focuses on panel-level events:
 * - Session creation notifications
 * - Panel-level error handling
 */

import type { Actor } from "xstate";

import { PanelUiEvent, type panelUiMachine } from "./panel-ui-machine.js";

/**
 * Notifies the panel machine when a session is successfully created.
 *
 * @param actor - The XState actor for the panel UI machine
 * @param sessionId - The ID of the newly created session
 */
export function notifySessionCreated(actor: Actor<typeof panelUiMachine>, sessionId: string): void {
	actor.send({
		type: PanelUiEvent.SESSION_CREATED,
		sessionId,
	});
}

/**
 * Notifies the panel machine of a panel-level error.
 * Panel-level errors are different from session errors (which are handled by the session machine).
 *
 * @param actor - The XState actor for the panel UI machine
 * @param error - The error message
 */
export function notifyPanelError(actor: Actor<typeof panelUiMachine>, error: string): void {
	actor.send({
		type: PanelUiEvent.PANEL_ERROR,
		error,
	});
}
