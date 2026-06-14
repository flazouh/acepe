<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Selector } from "@acepe/ui";
import { ResultAsync } from "neverthrow";
import type { Snippet } from "svelte";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { DEFAULT_EMPTY_MESSAGE } from "../constants/selector-constants.js";
import type { SelectorGroup } from "../types/selector-group.js";
import type { SelectorItem } from "../types/selector-item.js";
import { createLogger } from "../utils/logger.js";
import SelectorCheck from "./selector-check.svelte";
import {
	findSelectedSelectorItem,
	normalizeSelectorActionButtons,
	shouldDisableSelector,
	shouldShowSelectorActionSeparator,
	type SelectorActionButton,
} from "./selector-ui-state.js";

interface SelectorUIProps<T = string> {
	/**
	 * Available items to select from.
	 */
	items: SelectorItem<T>[];

	/**
	 * Currently selected item ID.
	 */
	selectedId: T | null;

	/**
	 * Whether the dropdown is open.
	 */
	isOpen: boolean;

	/**
	 * Whether the selector is in loading state.
	 */
	isLoading?: boolean;

	/**
	 * Whether the selector is disabled.
	 */
	disabled?: boolean;

	/**
	 * Optional groups for organizing items.
	 */
	groups?: SelectorGroup<T>[];

	/**
	 * Empty state message when no items are available.
	 */
	emptyMessage?: string;

	/**
	 * Callback when dropdown open state changes.
	 */
	onOpenChange: (isOpen: boolean) => void;

	/**
	 * Callback when an item is selected.
	 */
	onSelect: (itemId: T) => void;

	/**
	 * Optional custom render function for item content.
	 */
	renderItem?: Snippet<[{ item: SelectorItem<T>; isSelected: boolean }]>;

	/**
	 * Optional custom render function for button content.
	 */
	renderButton?: Snippet<[{ item: SelectorItem<T> | null; isLoading: boolean }]>;

	/**
	 * Optional action buttons (e.g., "Browse" for projects, "Import from Claude").
	 * If provided, will be shown at the bottom of the dropdown.
	 * Icon can be either a Svelte component or an image path (string).
	 */
	actionButtons?: SelectorActionButton[];

	/**
	 * Callback to check if an item is selected.
	 */
	isItemSelected: (item: SelectorItem<T>) => boolean;
}

let {
	items,
	selectedId,
	isOpen,
	isLoading = false,
	disabled = false,
	groups,
	emptyMessage = DEFAULT_EMPTY_MESSAGE,
	onOpenChange,
	onSelect,
	renderItem,
	renderButton,
	actionButtons,
	isItemSelected,
}: SelectorUIProps = $props();

const logger = createLogger({
	id: LOGGER_IDS.SELECTOR_UI,
	name: "Selector UI",
});

const selectedItem = $derived.by(() => {
	return findSelectedSelectorItem(items, selectedId);
});

const allActionButtons = $derived.by(() => {
	return normalizeSelectorActionButtons(actionButtons);
});

const isSelectorDisabled = $derived.by(() => {
	return shouldDisableSelector({
		disabled,
		isLoading,
		itemCount: items.length,
		actionButtonCount: allActionButtons.length,
	});
});

const showActionSeparator = $derived.by(() => {
	return shouldShowSelectorActionSeparator(items, groups);
});

/**
 * Handle action button click.
 * Properly handles async onClick functions.
 * Note: DropdownMenu.Item's onSelect automatically closes the dropdown,
 * so we don't need to manually close it.
 */
async function handleActionButtonClick(button: SelectorActionButton) {
	const result = button.onClick();
	if (result instanceof Promise) {
		const asyncResult = await ResultAsync.fromPromise(
			result,
			(error) =>
				new Error(
					`Action button click failed: ${error instanceof Error ? error.message : String(error)}`
				)
		);

		asyncResult.mapErr((error) => {
			logger.error("Action button click failed:", error);
		});
	}
}
</script>

<Selector
	open={isOpen}
	disabled={isSelectorDisabled}
	align="end"
	onOpenChange={onOpenChange}
>
	{#snippet renderButton()}
		{#if renderButton}
			{@render renderButton({ item: selectedItem, isLoading })}
		{:else if isLoading}
			<Spinner class="shrink-0" size={16} />
		{:else if selectedItem?.icon}
			<img
				src={selectedItem.icon}
				alt={selectedItem.name}
				class={selectedItem.iconClass ?? "h-4 w-4 shrink-0"}
			/>
			<span class="text-xs">{selectedItem.name}</span>
		{:else}
			<span class="text-xs">{selectedItem?.name ?? "Select..."}</span>
		{/if}
	{/snippet}

	{#if items.length === 0}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">
			{emptyMessage}
		</div>
	{:else if groups && groups.length > 0}
		{#each groups as group (group.id)}
			{#if group.items.length > 0}
				{#if group.label}
					<DropdownMenu.Label class="text-xs font-semibold">
						{group.label}
					</DropdownMenu.Label>
				{/if}
				{#each group.items as item (item.id)}
					<DropdownMenu.Item
						onSelect={() => onSelect(item.id)}
						class="group/item py-1 {isItemSelected(item) ? 'bg-accent' : ''}"
					>
						{#if renderItem}
							{@render renderItem({ item, isSelected: isItemSelected(item) })}
						{:else}
							<div class="flex items-center gap-2 w-full">
								{#if item.icon}
									<img
										src={item.icon}
										alt={item.name}
										class={item.iconClass ?? "h-4 w-4 shrink-0"}
									/>
								{/if}
								<span class="flex-1 text-sm">{item.name}</span>
								<SelectorCheck visible={isItemSelected(item)} />
							</div>
						{/if}
					</DropdownMenu.Item>
				{/each}
				{#if group.id !== groups[groups.length - 1]?.id}
					<DropdownMenu.Separator />
				{/if}
			{/if}
		{/each}
	{:else}
		{#each items as item (item.id)}
			<DropdownMenu.Item
				onSelect={() => onSelect(item.id)}
				class="group/item py-1 {isItemSelected(item) ? 'bg-accent' : ''}"
			>
				{#if renderItem}
					{@render renderItem({ item, isSelected: isItemSelected(item) })}
				{:else}
					<div class="flex items-center gap-2 w-full">
						{#if item.icon}
							<img
								src={item.icon}
								alt={item.name}
								class={item.iconClass ?? "h-4 w-4 shrink-0"}
							/>
						{/if}
						<span class="flex-1 text-sm">{item.name}</span>
						<SelectorCheck visible={isItemSelected(item)} />
					</div>
				{/if}
			</DropdownMenu.Item>
		{/each}
	{/if}

	{#if allActionButtons.length > 0}
		{#if showActionSeparator}
			<DropdownMenu.Separator />
		{/if}
		{#each allActionButtons as button, index (index)}
			<DropdownMenu.Item
				onSelect={() => handleActionButtonClick(button)}
				class="cursor-pointer"
			>
				{#if button.icon}
					{#if typeof button.icon === "string"}
						<img src={button.icon} alt="" class="mr-2 h-4 w-4 shrink-0" />
					{:else}
						{@const Icon = button.icon}
						<Icon class="mr-2 h-4 w-4" />
					{/if}
				{/if}
				<span>{button.label}</span>
			</DropdownMenu.Item>
		{/each}
	{/if}
</Selector>
