export type FullscreenAuxPanelKind = "file" | "review" | "terminal" | "git" | "browser";

export interface FullscreenAuxPanelRef {
	kind: FullscreenAuxPanelKind;
	id: string;
}

interface AuxPanelShape {
	id: string;
	width: number;
}

interface ResolveFullscreenAuxPanelParams<
	F extends AuxPanelShape,
	R extends AuxPanelShape,
	T extends AuxPanelShape,
	G extends AuxPanelShape,
	B extends AuxPanelShape,
> {
	selectedAuxPanel: FullscreenAuxPanelRef | null;
	filePanels: F[];
	reviewPanels: R[];
	terminalPanels: T[];
	gitPanels: G[];
	browserPanels: B[];
}

export type ResolvedFullscreenAuxPanel<
	F extends AuxPanelShape,
	R extends AuxPanelShape,
	T extends AuxPanelShape,
	G extends AuxPanelShape,
	B extends AuxPanelShape,
> =
	| { kind: "file"; panel: F }
	| { kind: "review"; panel: R }
	| { kind: "terminal"; panel: T }
	| { kind: "git"; panel: G }
	| { kind: "browser"; panel: B }
	| null;

export const FULLSCREEN_AUX_PANEL_MIN_WIDTH = 320;
export const FULLSCREEN_AUX_PANEL_MAX_WIDTH = 640;

export function clampFullscreenAuxPanelWidth(width: number): number {
	return Math.min(
		FULLSCREEN_AUX_PANEL_MAX_WIDTH,
		Math.max(FULLSCREEN_AUX_PANEL_MIN_WIDTH, Math.round(width))
	);
}

export function resolveFullscreenAuxPanel<
	F extends AuxPanelShape,
	R extends AuxPanelShape,
	T extends AuxPanelShape,
	G extends AuxPanelShape,
	B extends AuxPanelShape,
>({
	selectedAuxPanel,
	filePanels,
	reviewPanels,
	terminalPanels,
	gitPanels,
	browserPanels,
}: ResolveFullscreenAuxPanelParams<F, R, T, G, B>): ResolvedFullscreenAuxPanel<F, R, T, G, B> {
	if (selectedAuxPanel) {
		const selected = getPanelByKind(selectedAuxPanel.kind, selectedAuxPanel.id, {
			filePanels,
			reviewPanels,
			terminalPanels,
			gitPanels,
			browserPanels,
		});
		if (selected) return selected;
	}

	if (filePanels.length > 0) return { kind: "file", panel: filePanels[0] };
	if (reviewPanels.length > 0) return { kind: "review", panel: reviewPanels[0] };
	if (terminalPanels.length > 0) return { kind: "terminal", panel: terminalPanels[0] };
	if (gitPanels.length > 0) return { kind: "git", panel: gitPanels[0] };
	if (browserPanels.length > 0) return { kind: "browser", panel: browserPanels[0] };
	return null;
}

function getPanelByKind<
	F extends AuxPanelShape,
	R extends AuxPanelShape,
	T extends AuxPanelShape,
	G extends AuxPanelShape,
	B extends AuxPanelShape,
>(
	kind: FullscreenAuxPanelKind,
	id: string,
	panels: Pick<
		ResolveFullscreenAuxPanelParams<F, R, T, G, B>,
		"filePanels" | "reviewPanels" | "terminalPanels" | "gitPanels" | "browserPanels"
	>
): ResolvedFullscreenAuxPanel<F, R, T, G, B> {
	if (kind === "file") {
		const panel = panels.filePanels.find((candidate) => candidate.id === id);
		return panel ? { kind: "file", panel } : null;
	}
	if (kind === "review") {
		const panel = panels.reviewPanels.find((candidate) => candidate.id === id);
		return panel ? { kind: "review", panel } : null;
	}
	if (kind === "terminal") {
		const panel = panels.terminalPanels.find((candidate) => candidate.id === id);
		return panel ? { kind: "terminal", panel } : null;
	}
	if (kind === "git") {
		const panel = panels.gitPanels.find((candidate) => candidate.id === id);
		return panel ? { kind: "git", panel } : null;
	}

	const panel = panels.browserPanels.find((candidate) => candidate.id === id);
	return panel ? { kind: "browser", panel } : null;
}
