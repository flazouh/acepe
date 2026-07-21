import type { Component } from "svelte";
import type { SelectorGroup } from "../types/selector-group.js";
import type { SelectorItem } from "../types/selector-item.js";

export interface SelectorActionButton {
	label: string;
	icon?: Component | string;
	onClick: () => void | Promise<void>;
}

export function findSelectedSelectorItem<T>(
	items: SelectorItem<T>[],
	selectedId: T | null
): SelectorItem<T> | null {
	return items.find((item) => item.id === selectedId) ?? null;
}

export function normalizeSelectorActionButtons(
	actionButtons: SelectorActionButton[] | undefined
): SelectorActionButton[] {
	return actionButtons ?? [];
}

interface SelectorDisabledInput {
	disabled: boolean;
	isLoading: boolean;
	itemCount: number;
	actionButtonCount: number;
}

export function shouldDisableSelector(input: SelectorDisabledInput): boolean {
	return (
		input.disabled || input.isLoading || (input.itemCount === 0 && input.actionButtonCount === 0)
	);
}

export function shouldShowSelectorActionSeparator<T>(
	items: SelectorItem<T>[],
	groups: SelectorGroup<T>[] | undefined
): boolean {
	return items.length > 0 || (groups !== undefined && groups.length > 0);
}
