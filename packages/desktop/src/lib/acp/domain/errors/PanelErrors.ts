import { DomainError } from "./DomainError";

/**
 * Error thrown when panel is not found.
 */
export class PanelNotFoundError extends DomainError {
	readonly code = "PANEL_NOT_FOUND";

	constructor(panelId: string) {
		super(`Panel not found: ${panelId}`);
	}
}
