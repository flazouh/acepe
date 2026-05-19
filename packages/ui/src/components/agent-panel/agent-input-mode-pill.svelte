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
</script>

<div
	class="inline-flex shrink-0 items-center gap-px"
	role="group"
	aria-label="Mode"
>
	{#each modes as mode (mode.id)}
		{@const isSelected = mode.id === currentModeId}
		{@const label = modeLabel(mode)}
		<button
			type="button"
			{disabled}
			aria-pressed={isSelected}
			aria-label={label}
			title={label}
			class="inline-flex h-7 w-7 shrink-0 items-center justify-center transition-colors
				{isSelected ? 'bg-background dark:bg-input/30 text-foreground' : 'text-muted-foreground hover:text-foreground'}
				{disabled ? 'cursor-default opacity-50' : 'cursor-pointer'}"
			onclick={() => { if (!disabled) onModeChange(mode.id); }}
		>
			{#if mode.id === planModeId}
				<PlanIcon size="sm" class="shrink-0" style="color: {isSelected ? iconColor(mode.id) : 'currentColor'}" />
			{:else}
				<BuildIcon size="sm" class="shrink-0" style="color: {isSelected ? iconColor(mode.id) : 'currentColor'}" />
			{/if}
		</button>
	{/each}
</div>
