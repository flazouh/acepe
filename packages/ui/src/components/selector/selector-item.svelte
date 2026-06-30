<script lang="ts">
	import type { Snippet } from "svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import {
		dropdownMenuItemTypographyClass,
		dropdownMenuSectionTypographyClass,
	} from "../dropdown-menu/dropdown-menu-typography.js";

	interface Props {
		label: string;
		description?: string;
		selected?: boolean;
		disabled?: boolean;
		dense?: boolean;
		labelClass?: string;
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
		onSelect,
		leading,
		trailing,
	}: Props = $props();
</script>

<DropdownMenu.Item
	{onSelect}
	{disabled}
	class="group/item transition-colors {dense ? 'py-0.5' : 'py-1'} {selected ? 'bg-accent' : ''}"
>
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
	</div>
</DropdownMenu.Item>
