import type { AvailableCommand } from "../../../types/available-command.js";

import {
	isEscapeKey,
	isNavigationKey,
	isSelectionKey,
	navigateDown,
	navigateUp,
} from "../logic/keyboard-navigation.js";

/**
 * State manager for the SlashCommandDropdown component.
 *
 * Manages local UI state for command selection and keyboard navigation.
 * Follows idiomatic Svelte 5 pattern: classes manage local state only.
 *
 * Props should be kept in the component and passed as parameters to methods.
 *
 * @example
 * ```ts
 * const state = new SlashCommandDropdownState();
 * state.handleKeyDown(event, isOpen, filteredCommands, onSelect, onClose);
 * ```
 */
export class SlashCommandDropdownState {
	/**
	 * Currently selected index for keyboard navigation.
	 */
	selectedIndex = $state(0);

	/**
	 * References to command item elements for scrolling.
	 */
	itemRefs: Record<number, HTMLDivElement> = $state({});

	/**
	 * Reset selection to first item.
	 */
	resetSelection(): void {
		this.selectedIndex = 0;
	}

	/**
	 * Scroll selected item into view.
	 */
	scrollSelectedIntoView(): void {
		const itemEl = this.itemRefs[this.selectedIndex];
		if (itemEl) {
			itemEl.scrollIntoView({ block: "nearest", behavior: "instant" });
		}
	}

	/**
	 * Handle keyboard navigation and selection.
	 *
	 * @param event - Keyboard event
	 * @param isOpen - Whether dropdown is open
	 * @param filteredCommands - Filtered commands
	 * @param onSelect - Callback when command is selected
	 * @param onClose - Callback when dropdown should close
	 * @returns True if the event was handled
	 */
	handleKeyDown(
		event: KeyboardEvent,
		isOpen: boolean,
		filteredCommands: AvailableCommand[],
		onSelect: (command: AvailableCommand) => void,
		onClose: () => void
	): boolean {
		if (!isOpen) {
			return false;
		}

		if (isNavigationKey(event)) {
			event.preventDefault();
			if (event.key === "ArrowDown") {
				this.selectedIndex = navigateDown(this.selectedIndex, filteredCommands.length);
			} else {
				this.selectedIndex = navigateUp(this.selectedIndex, filteredCommands.length);
			}
			// Use setTimeout to ensure DOM has updated
			setTimeout(() => this.scrollSelectedIntoView(), 0);
			return true;
		}

		if (isSelectionKey(event)) {
			if (filteredCommands.length > 0) {
				event.preventDefault();
				onSelect(filteredCommands[this.selectedIndex]);
				return true;
			}
		}

		if (isEscapeKey(event)) {
			event.preventDefault();
			onClose();
			return true;
		}

		return false;
	}

	/**
	 * Handle item click.
	 *
	 * @param command - Command that was clicked
	 * @param onSelect - Callback when command is selected
	 */
	handleItemClick(command: AvailableCommand, onSelect: (command: AvailableCommand) => void): void {
		onSelect(command);
	}

	/**
	 * Handle item hover.
	 *
	 * @param index - Index of hovered item
	 */
	handleItemHover(index: number): void {
		this.selectedIndex = index;
	}
}
