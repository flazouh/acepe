import type { TerminalTab } from "$lib/acp/store/types.js";

export function getTerminalShellName(shell: string | null): string | null {
	if (!shell) return null;
	const shellName = shell.split("/").pop();
	return shellName ? shellName : null;
}

export function shouldShowTerminalFullscreenAction(input: {
	readonly onEnterFullscreen: (() => void) | undefined;
	readonly onExitFullscreen: (() => void) | undefined;
}): boolean {
	return input.onEnterFullscreen !== undefined || input.onExitFullscreen !== undefined;
}

export function hasTerminalTabs(tabs: readonly TerminalTab[] | undefined): boolean {
	return tabs !== undefined && tabs.length > 0;
}

export function canShowTerminalTabMenu(input: {
	readonly tabs: readonly TerminalTab[] | undefined;
	readonly onCloseTab: ((id: string) => void) | undefined;
	readonly onMoveTabToNewPanel: ((id: string) => void) | undefined;
}): boolean {
	if (input.tabs === undefined) return false;
	return input.onCloseTab !== undefined || input.onMoveTabToNewPanel !== undefined;
}

export function canShowMoveTerminalTabAction(input: {
	readonly tabId: string;
	readonly tabs: readonly TerminalTab[] | undefined;
	readonly onMoveTabToNewPanel: ((id: string) => void) | undefined;
	readonly canMoveTabToNewPanel: ((id: string) => boolean) | undefined;
}): boolean {
	if (!input.tabs || input.tabs.length <= 1) return false;
	if (!input.onMoveTabToNewPanel) return false;
	return input.canMoveTabToNewPanel ? input.canMoveTabToNewPanel(input.tabId) : false;
}

export function canShowCloseTerminalTabAction(input: {
	readonly tabs: readonly TerminalTab[] | undefined;
	readonly onCloseTab: ((id: string) => void) | undefined;
}): boolean {
	if (!input.tabs) return false;
	return input.tabs.length > 1 && input.onCloseTab !== undefined;
}

export function getNextOpenTerminalTabMenuId(input: {
	readonly openMenuTabId: string | null;
	readonly tabId: string;
}): string | null {
	return input.openMenuTabId === input.tabId ? null : input.tabId;
}
