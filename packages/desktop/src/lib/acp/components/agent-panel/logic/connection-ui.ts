import type { FailureReason } from "$lib/services/acp-types.js";
import type { TurnState } from "../../../store/types.js";
import type { ErrorMessage } from "../../../types/error-message.js";
import type { PanelConnectionErrorDetails } from "../../../types/panel-connection-state";
import { PanelConnectionState } from "../../../types/panel-connection-state";
import { failureCopy } from "./failure-copy.js";

export type PanelErrorRecoveryAction = "unarchive";

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
	readonly recoveryAction: PanelErrorRecoveryAction | null;
	readonly canRetry?: boolean;
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
		error.code && error.code !== error.content ? `Code: ${error.code}` : null,
		error.source ? `Source: ${error.source}` : null,
		error.details?.trim() ? error.details.trim() : null,
	].filter((value): value is string => value !== null);

	return suffixes.join("\n\n");
}

export function derivePanelErrorInfo(inputs: PanelErrorInputs): PanelErrorInfo {
	const panelHasError = inputs.panelConnectionState === PanelConnectionState.ERROR;
	const sessionHasError = typeof inputs.sessionConnectionError === "string";
	// activeTurnError is itself a canonical failure fact. Do not hide it while a
	// separate turn-state envelope is delayed or a restored session is reconciling.
	const turnHasError = inputs.activeTurnError !== null;

	if (panelHasError) {
		// A panel-level error may carry a canonical classification (e.g. a
		// pre-session creation failure that resolved to `authenticationRequired`).
		// When it does, render the same curated card the resume path produces
		// rather than the raw creation message — single classification authority.
		const panelFailureReason = inputs.panelConnectionError?.failureReason ?? null;
		const curated =
			panelFailureReason !== null
				? failureCopy(inputs.agentDisplayName, panelFailureReason)
				: null;
		const rawMessage = inputs.panelConnectionError?.message ?? null;
		const display = curated ?? rawMessage;
		return {
			showError: true,
			title: "Connection error",
			summary: summarize(display),
			details: display,
			referenceId: inputs.panelConnectionError?.referenceId ?? null,
			referenceSearchable: inputs.panelConnectionError?.referenceSearchable === true,
			failureReason: panelFailureReason,
			recoveryAction: null,
			canRetry: true,
		};
	}

	if (sessionHasError) {
		if (inputs.sessionFailureReason === "sessionArchivedUpstream") {
			return {
				showError: true,
				title: "Session archived",
				summary: null,
				details: null,
				referenceId: null,
				referenceSearchable: false,
				failureReason: inputs.sessionFailureReason,
				recoveryAction: "unarchive",
				canRetry: false,
			};
		}

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
			recoveryAction: null,
			canRetry: true,
		};
	}

	if (turnHasError) {
		const details = formatTurnErrorDetails(inputs.activeTurnError);
		return {
			showError: true,
			title: inputs.activeTurnError.kind === "fatal" ? "Agent error" : "Request error",
			summary: inputs.activeTurnError.content,
			details: details.length > 0 ? details : null,
			referenceId: inputs.activeTurnError.referenceId ?? null,
			referenceSearchable: inputs.activeTurnError.referenceSearchable === true,
			failureReason: null,
			recoveryAction: null,
			canRetry: inputs.activeTurnError.kind !== "fatal",
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
		recoveryAction: null,
		canRetry: false,
	};
}

export function shouldShowInlinePanelError(input: {
	readonly showError: boolean;
	readonly errorDismissed: boolean;
	readonly viewKind: string;
	readonly hasTranscript: boolean;
}): boolean {
	if (!input.showError || input.errorDismissed) {
		return false;
	}

	return input.viewKind !== "error" || input.hasTranscript;
}
