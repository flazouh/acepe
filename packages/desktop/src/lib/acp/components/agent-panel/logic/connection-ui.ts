import type { ErrorMessage } from "../../../types/error-message.js";
import type { PanelConnectionErrorDetails } from "../../../types/panel-connection-state";
import type { TurnState } from "../../../store/types.js";
import { PanelConnectionState } from "../../../types/panel-connection-state";

export interface PanelErrorInfo {
	readonly showError: boolean;
	readonly title: string;
	readonly summary: string | null;
	readonly details: string | null;
	readonly referenceId: string | null;
	readonly referenceSearchable: boolean;
}

interface PanelErrorInputs {
	readonly panelConnectionState: PanelConnectionState | null;
	readonly panelConnectionError: PanelConnectionErrorDetails | null;
	readonly sessionConnectionError: string | null;
	readonly sessionTurnState?: TurnState;
	readonly activeTurnError: ErrorMessage | null;
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
	const turnHasError =
		inputs.sessionTurnState === "error" && inputs.activeTurnError !== null;

	if (panelHasError) {
		return {
			showError: true,
			title: "Connection error",
			summary: summarize(inputs.panelConnectionError?.message ?? null),
			details: inputs.panelConnectionError?.message ?? null,
			referenceId: inputs.panelConnectionError?.referenceId ?? null,
			referenceSearchable: inputs.panelConnectionError?.referenceSearchable === true,
		};
	}

	if (sessionHasError) {
		return {
			showError: true,
			title: "Connection error",
			summary: summarize(inputs.sessionConnectionError),
			details: inputs.sessionConnectionError,
			referenceId: null,
			referenceSearchable: false,
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
		};
	}

	return {
		showError: false,
		title: "Connection error",
		summary: null,
		details: null,
		referenceId: null,
		referenceSearchable: false,
	};
}
