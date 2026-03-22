import { PanelConnectionState } from "../../../types/panel-connection-state";

export interface PanelErrorInfo {
	readonly showError: boolean;
	readonly details: string | null;
}

interface PanelErrorInputs {
	readonly panelConnectionState: PanelConnectionState | null;
	readonly panelConnectionError: string | null;
	readonly sessionConnectionError: string | null;
}

export function derivePanelErrorInfo(inputs: PanelErrorInputs): PanelErrorInfo {
	const panelHasError = inputs.panelConnectionState === PanelConnectionState.ERROR;
	const sessionHasError = typeof inputs.sessionConnectionError === "string";

	const details = panelHasError
		? inputs.panelConnectionError
		: sessionHasError
			? inputs.sessionConnectionError
			: null;

	return {
		showError: panelHasError || sessionHasError,
		details,
	};
}
