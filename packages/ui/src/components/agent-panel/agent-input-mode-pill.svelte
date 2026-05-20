<!--
  AgentInputModePill - Compact pill segmented control for Plan/Build mode selection.
  Sits inline next to the submit button in the composer editor row.
-->
<script lang="ts">
	import { BuildIcon, PlanIcon } from "../icons/index.js";
	import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";

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
		planDescription?: string;
		buildDescription?: string;
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
		planDescription = "Think through the approach before writing code. The agent researches, asks clarifying questions, and proposes a plan without making changes.",
		buildDescription = "Execute the work. The agent edits files, runs commands, and applies changes directly.",
		disabled = false,
		onModeChange,
	}: Props = $props();

	function modeLabel(mode: Mode): string {
		if (mode.id === planModeId) return mode.label ?? planLabel;
		if (mode.id === buildModeId) return mode.label ?? buildLabel;
		return mode.label ?? mode.id;
	}

	function modeDescription(modeId: string): string | null {
		if (modeId === planModeId) return planDescription;
		if (modeId === buildModeId) return buildDescription;
		return null;
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
		{@const description = modeDescription(mode.id)}
		<Tooltip>
			<TooltipTrigger>
				{#snippet child({ props: triggerProps })}
					<button
						{...triggerProps}
						type="button"
						{disabled}
						aria-pressed={isSelected}
						aria-label={label}
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
				{/snippet}
			</TooltipTrigger>
			<TooltipContent class="max-w-xs">
				<div class="flex flex-col gap-0.5">
					<span class="font-medium">{label}</span>
					{#if description}
						<span class="text-muted-foreground">{description}</span>
					{/if}
				</div>
			</TooltipContent>
		</Tooltip>
	{/each}
</div>
