import type { FailureReason } from "$lib/services/acp-types.js";
import type { TurnState } from "../../../store/types.js";
import type { ErrorMessage } from "../../../types/error-message.js";
import type { PanelConnectionErrorDetails } from "../../../types/panel-connection-state";
import { PanelConnectionState } from "../../../types/panel-connection-state";
import { failureCopy } from "./failure-copy.js";

export interface PanelErrorInfo {
	readonly showError: boolean;
	readonly title: string;
	readonly summary: string | null;
	readonly details: string | null;
	readonly referenceId: string | null;
	readonly referenceSearchable: boolean;
	/**
	 * Canonical lifecycle failure classification when the error originates
	 * from a session-level failure. `null` for unclassified cases (panel-level
	 * errors, turn errors, or sessions whose lifecycle has no `failureReason`).
	 */
	readonly failureReason: FailureReason | null;
}

interface PanelErrorInputs {
	readonly panelConnectionState: PanelConnectionState | null;
	readonly panelConnectionError: PanelConnectionErrorDetails | null;
	readonly sessionConnectionError: string | null;
	readonly sessionTurnState?: TurnState;
	readonly activeTurnError: ErrorMessage | null;
	/**
	 * Canonical lifecycle failure classification for the active session, or
	 * `null` if none. Required so the panel can compose curated copy via
	 * `failureCopy(agentDisplayName, failureReason)` instead of leaking raw provider
	 * text into the inline error UI.
	 */
	readonly sessionFailureReason: FailureReason | null;
	/**
	 * Active session's resolved agent display name. Optional for pre-session
	 * call sites where no session-level error can be present.
	 */
	readonly agentDisplayName: string | null;
}

function summarize(details: string | null): string | null {
	return details?.split("\n")[0]?.slice(0, 80) ?? null;
}

function formatTurnErrorDetails(error: ErrorMessage): string {
	const suffixes = [
		error.code ? `Code: ${error.code}` : null,
		error.source ? `Source: ${error.source}` : null,
	].filter((value): value is string => value !== null);

	if (suffixes.length === 0) {
		return error.content;
	}

	return `${error.content}\n\n${suffixes.join("\n")}`;
}

export function derivePanelErrorInfo(inputs: PanelErrorInputs): PanelErrorInfo {
	const panelHasError = inputs.panelConnectionState === PanelConnectionState.ERROR;
	const sessionHasError = typeof inputs.sessionConnectionError === "string";
	const turnHasError = inputs.sessionTurnState === "error" && inputs.activeTurnError !== null;

	if (panelHasError) {
		return {
			showError: true,
			title: "Connection error",
			summary: summarize(inputs.panelConnectionError?.message ?? null),
			details: inputs.panelConnectionError?.message ?? null,
			referenceId: inputs.panelConnectionError?.referenceId ?? null,
			referenceSearchable: inputs.panelConnectionError?.referenceSearchable === true,
			failureReason: null,
		};
	}

	if (sessionHasError) {
		const curated =
			inputs.sessionFailureReason !== null
				? failureCopy(inputs.agentDisplayName, inputs.sessionFailureReason)
				: null;
		const display = curated ?? inputs.sessionConnectionError;
		return {
			showError: true,
			title: "Connection error",
			summary: summarize(display),
			details: display,
			referenceId: null,
			referenceSearchable: false,
			failureReason: inputs.sessionFailureReason,
		};
	}

	if (turnHasError) {
		const details = formatTurnErrorDetails(inputs.activeTurnError);
		return {
			showError: true,
			title: inputs.activeTurnError.kind === "fatal" ? "Agent error" : "Request error",
			summary: summarize(inputs.activeTurnError.content),
			details,
			referenceId: inputs.activeTurnError.referenceId ?? null,
			referenceSearchable: inputs.activeTurnError.referenceSearchable === true,
			failureReason: null,
		};
	}

	return {
		showError: false,
		title: "Connection error",
		summary: null,
		details: null,
		referenceId: null,
		referenceSearchable: false,
		failureReason: null,
	};
}
