const SHELL_ERROR_PREFIX = "Failed to load shell";
const PTY_ERROR_PREFIX = "Failed to start terminal";

export function getTerminalPanelWidthStyle(input: {
	readonly width: number;
	readonly isFullscreenEmbedded: boolean;
}): string {
	if (input.isFullscreenEmbedded) {
		return "min-width: 0;";
	}
	return `min-width: ${input.width}px; width: ${input.width}px; max-width: ${input.width}px;`;
}

export function getTerminalPanelCombinedError(input: {
	readonly shellError: string | null;
	readonly ptyError: string | null;
}): string | null {
	if (input.shellError) {
		return `${SHELL_ERROR_PREFIX}: ${input.shellError}`;
	}
	if (input.ptyError) {
		return `${PTY_ERROR_PREFIX}: ${input.ptyError}`;
	}
	return null;
}

export function shouldShowTerminalPanelResizeEdge(isFullscreenEmbedded: boolean): boolean {
	return !isFullscreenEmbedded;
}
