<script lang="ts">
	import type { Snippet } from "svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import {
		dropdownMenuItemTypographyClass,
		dropdownMenuSectionTypographyClass,
	} from "../dropdown-menu/dropdown-menu-typography.js";
	import { HugeiconsIcon } from "../icons/index.js";

	interface Props {
		label: string;
		description?: string;
		selected?: boolean;
		disabled?: boolean;
		dense?: boolean;
		labelClass?: string;
		/**
		 * When set, the row renders as a menu radio item (role="menuitemradio").
		 * Selection then comes from the enclosing DropdownMenu.RadioGroup value,
		 * which the primitive requires; `selected` is ignored.
		 */
		radioValue?: string;
		onSelect?: () => void;
		leading?: Snippet;
		trailing?: Snippet;
	}

	let {
		label,
		description,
		selected = false,
		disabled = false,
		dense = false,
		labelClass = "",
		radioValue,
		onSelect,
		leading,
		trailing,
	}: Props = $props();

	const baseItemClass = $derived(`group/item transition-colors ${dense ? "py-0.5" : "py-1"}`);
</script>

{#snippet content(isSelected: boolean)}
	<div
		class="flex w-full min-w-0 gap-2 {description ? 'items-start' : 'items-center'}"
	>
		{#if leading}{@render leading()}{/if}
		{#if description}
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<span class="truncate {dropdownMenuItemTypographyClass} {labelClass}">{label}</span>
				<span class="{dropdownMenuSectionTypographyClass} text-muted-foreground">{description}</span>
			</div>
		{:else}
			<span class="flex-1 truncate {dropdownMenuItemTypographyClass} {labelClass}">{label}</span>
		{/if}
		{#if trailing}{@render trailing()}{/if}
		{#if isSelected}
			<HugeiconsIcon name="check" class="size-3.5 shrink-0 text-current" />
		{/if}
	</div>
{/snippet}

{#if radioValue !== undefined}
	<DropdownMenu.RadioItem
		value={radioValue}
		{onSelect}
		{disabled}
		hideIndicator
		class="ps-2 {baseItemClass} data-[state=checked]:bg-accent"
	>
		{#snippet children({ checked })}
			{@render content(checked)}
		{/snippet}
	</DropdownMenu.RadioItem>
{:else}
	<DropdownMenu.Item {onSelect} {disabled} class="{baseItemClass} {selected ? 'bg-accent' : ''}">
		{@render content(selected)}
	</DropdownMenu.Item>
{/if}
