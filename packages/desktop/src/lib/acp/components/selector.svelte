<script lang="ts">
import type { ResultAsync } from "neverthrow";
import { LOGGER_IDS } from "../constants/logger-ids.js";

import { DEFAULT_EMPTY_MESSAGE } from "../constants/selector-constants.js";
import { groupItems } from "../logic/selector-logic.js";
import { SelectorState } from "../state/selector-state.svelte.js";
import type { SelectorConfig } from "../types/selector-config.js";
import { createLogger } from "../utils/logger.js";
import SelectorUI from "./selector-ui.svelte";

interface SelectorProps<T = string> {
	/**
	 * Selector configuration.
	 */
	config: SelectorConfig<T>;

	/**
	 * Callback when an item is selected.
	 * Must return ResultAsync for proper error handling.
	 */
	onSelect: (itemId: T) => ResultAsync<void, Error>;

	/**
	 * Optional callback when dropdown open state changes.
	 */
	onToggle?: (isOpen: boolean) => void;
}

let { config, onSelect, onToggle }: SelectorProps = $props();

const logger = createLogger({
	id: LOGGER_IDS.SELECTOR,
	name: "Selector",
});

// UI state manager - manages ONLY local UI state (dropdown open/closed)
// Props (items, selectedId, isLoading, groups) come from config directly
const uiState = new SelectorState<string>();

// Compute groups from config using $derived (reactive, no state syncing needed)
const groups = $derived.by(() => {
	if (config.groups && config.groups.length > 0) {
		return config.groups;
	}
	return groupItems(config.items);
});

// Expose toggle method to parent
export function toggle() {
	uiState.toggle(onToggle);
}

// Expose select method to parent (for keyboard shortcuts)
export function select(itemId: string) {
	handleSelect(itemId);
}

function handleSelect(itemId: string) {
	// Don't select if already selected
	if (config.selectedId === itemId) {
		return;
	}

	onSelect(itemId)
		.map(() => {
			// Close dropdown on successful selection
			uiState.setOpen(false, onToggle);
		})
		.mapErr((error) => {
			logger.error("Selector selection failed:", error);
			// Keep dropdown open on error so user can retry
		});
}

function handleToggle(isOpen: boolean) {
	uiState.setOpen(isOpen, onToggle);
}
</script>

<SelectorUI
	items={config.items}
	selectedId={config.selectedId}
	isOpen={uiState.isOpen}
	isLoading={config.isLoading ?? false}
	disabled={config.disabled}
	{groups}
	emptyMessage={config.emptyMessage ?? DEFAULT_EMPTY_MESSAGE}
	onOpenChange={handleToggle}
	onSelect={handleSelect}
	renderItem={config.renderConfig?.renderItem}
	renderButton={config.renderConfig?.renderButton}
	actionButtons={config.actionButtons}
	isItemSelected={(item) => item.id === config.selectedId}
/>
