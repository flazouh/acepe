<!--
  AgentInputModeSelector - Mode toggle buttons (plan/build) in the composer toolbar.

  Extracted from packages/desktop/src/lib/acp/components/mode-selector.svelte.
  State and registry stay in desktop. Component accepts mode list and callback.
-->
<script lang="ts">
	import { BuildIcon, PlanIcon } from "../icons/index.js";

	export interface AgentInputMode {
		id: string;
		label?: string;
	}

	interface Props {
		availableModes: readonly AgentInputMode[];
		currentModeId: string | null;
		planModeId?: string;
		buildModeId?: string;
		planLabel?: string;
		buildLabel?: string;
		onModeChange: (modeId: string) => void;
	}

	let {
		availableModes,
		currentModeId,
		planModeId = "plan",
		buildModeId = "build",
		planLabel = "Plan",
		buildLabel = "Build",
		onModeChange,
	}: Props = $props();

	function modeColor(modeId: string): string {
		if (modeId === buildModeId) return "var(--build-icon)";
		if (modeId === planModeId) return "var(--plan-icon)";
		return "var(--build-icon)";
	}

	function handleModeChange(modeId: string) {
		if (modeId !== currentModeId) {
			onModeChange(modeId);
		}
	}

	function isSelected(modeId: string): boolean {
		return modeId === currentModeId;
	}

	function modeLabel(modeId: string): string {
		return modeId === planModeId ? planLabel : buildLabel;
	}
</script>

<div role="group" class="flex h-7 w-fit items-stretch">
	{#if availableModes.length === 0}
		<div class="flex items-center justify-center w-7">
			<BuildIcon size="sm" />
		</div>
	{:else}
		{#each [...availableModes].reverse() as mode, i (mode.id)}
			{@const color = modeColor(mode.id)}
			{@const selected = isSelected(mode.id)}
			{#if i > 0}
				<div class="w-px self-stretch bg-border/50"></div>
			{/if}
			<button
				type="button"
				onclick={() => handleModeChange(mode.id)}
				class="flex items-center justify-center w-7 text-[11px] font-medium transition-colors rounded-none
					{selected
					? 'bg-accent text-foreground'
					: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
				title={modeLabel(mode.id)}
				aria-label={modeLabel(mode.id)}
			>
				{#if mode.id === planModeId}
					<PlanIcon
						size="sm"
						class="transition-colors duration-150"
						style={selected ? `color: ${color}` : undefined}
					/>
				{:else}
					<BuildIcon
						size="sm"
						class="transition-colors duration-150"
						style={selected ? `color: ${color}` : undefined}
					/>
				{/if}
			</button>
		{/each}
	{/if}
</div>
