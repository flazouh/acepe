<!--
  AgentInputModePill - Compact segmented control for provider mode selection.
  Sits inline next to the submit button in the composer editor row.
-->
<script lang="ts">
	import { SlidersHorizontal } from "phosphor-svelte";

	interface Mode {
		readonly id: string;
		readonly name?: string;
		readonly label?: string;
	}

	interface Props {
		modes: readonly Mode[];
		currentModeId: string | null;
		disabled?: boolean;
		onModeChange: (modeId: string) => void;
	}

	let {
		modes,
		currentModeId,
		disabled = false,
		onModeChange,
	}: Props = $props();

	function modeLabel(mode: Mode): string {
		return mode.label ?? mode.name ?? mode.id;
	}

	const selectedIndex = $derived(modes.findIndex((m) => m.id === currentModeId));
</script>

<div
	class="inline-flex shrink-0 items-center gap-px"
	role="group"
	aria-label="Mode"
>
	{#each modes as mode (mode.id)}
		{@const isSelected = mode.id === currentModeId}
		<button
			type="button"
			{disabled}
			aria-pressed={isSelected}
			class="inline-flex flex-1 items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium leading-none transition-colors
				{isSelected ? 'bg-background dark:bg-input/30 text-foreground' : 'text-muted-foreground hover:text-foreground'}
				{disabled ? 'cursor-default opacity-50' : 'cursor-pointer'}"
			onclick={() => { if (!disabled) onModeChange(mode.id); }}
		>
			<SlidersHorizontal class="size-3.5 shrink-0" />
			{modeLabel(mode)}
		</button>
	{/each}
</div>
