<!--
  AgentInputSelectorItemRow - Standard selectable row for agent-panel selector dropdowns.

  Used by model, project, agent, and config-option menus for consistent layout:
  optional leading icon, label, optional trailing actions. Selected state uses bg-accent.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";

	interface Props {
		label: string;
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
	<div class="flex w-full min-w-0 items-center gap-2">
		{#if leading}{@render leading()}{/if}
		<span class="flex-1 truncate text-xs font-normal {labelClass}">{label}</span>
		{#if trailing}{@render trailing()}{/if}
	</div>
</DropdownMenu.Item>
