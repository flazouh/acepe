<!--
  AgentInputModePill - Compact pill segmented control for Plan/Build mode selection.
  Sits inline next to the submit button in the composer editor row.
-->
<script lang="ts">
	import { BuildIcon, PlanIcon } from "../icons/index.js";

	interface Mode {
		readonly id: string;
		readonly label?: string;
	}

	interface Props {
		modes: readonly Mode[];
		currentModeId: string | null;
		planModeId?: string;
		buildModeId?: string;
		planLabel?: string;
		buildLabel?: string;
		disabled?: boolean;
		onModeChange: (modeId: string) => void;
	}

	let {
		modes,
		currentModeId,
		planModeId = "plan",
		buildModeId = "build",
		planLabel = "Plan",
		buildLabel = "Build",
		disabled = false,
		onModeChange,
	}: Props = $props();

	function modeLabel(mode: Mode): string {
		if (mode.id === planModeId) return mode.label ?? planLabel;
		if (mode.id === buildModeId) return mode.label ?? buildLabel;
		return mode.label ?? mode.id;
	}

	function iconColor(modeId: string): string {
		if (modeId === planModeId) return "var(--plan-icon)";
		if (modeId === buildModeId) return "var(--build-icon)";
		return "currentColor";
	}

	const selectedIndex = $derived(modes.findIndex((m) => m.id === currentModeId));
</script>

<div
	class="relative inline-flex h-7 shrink-0 items-center rounded-full border border-border/60 bg-muted/40 p-0.5 gap-px"
	role="group"
	aria-label="Mode"
>
	{#if selectedIndex >= 0 && modes.length > 1}
		<div
			aria-hidden="true"
			class="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
			style="width: calc((100% - 4px - {modes.length - 1}px) / {modes.length}); transform: translateX(calc({selectedIndex} * (100% + 1px)));"
		></div>
	{/if}
	{#each modes as mode (mode.id)}
		{@const isSelected = mode.id === currentModeId}
		<button
			type="button"
			{disabled}
			aria-pressed={isSelected}
			class="relative z-[1] flex-1 inline-flex h-[22px] items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium leading-none transition-colors
				{isSelected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}
				{disabled ? 'cursor-default opacity-50' : 'cursor-pointer'}"
			onclick={() => { if (!disabled) onModeChange(mode.id); }}
		>
			{#if mode.id === planModeId}
				<PlanIcon size="sm" class="shrink-0" style="color: {isSelected ? iconColor(mode.id) : 'currentColor'}" />
			{:else}
				<BuildIcon size="sm" class="shrink-0" style="color: {isSelected ? iconColor(mode.id) : 'currentColor'}" />
			{/if}
			{modeLabel(mode)}
		</button>
	{/each}
</div>
