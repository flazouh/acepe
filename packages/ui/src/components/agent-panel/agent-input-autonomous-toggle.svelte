<!--
  AgentInputAutonomousToggle - Autonomous (lightning) toggle button in the composer toolbar.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/autonomous-toggle-button.svelte.
  Wraps the button in a rich Tooltip when a description is provided.
  Uses the Lightning icon so Robot stays reserved for "agent" across the app.
-->
<script lang="ts">
	import { ShieldCheck } from "phosphor-svelte";

	import { Colors } from "../../lib/colors.js";
	import { cn } from "../../lib/utils.js";
	import { Button } from "../button/index.js";
	import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";

	interface Props {
		active: boolean;
		disabled?: boolean;
		busy?: boolean;
		title?: string;
		ariaLabel?: string;
		/** Optional richer description rendered below the title in the tooltip. */
		tooltipDescription?: string;
		onToggle: () => void;
	}

	let {
		active,
		disabled = false,
		busy = false,
		title = "Auto-approve",
		ariaLabel = "Auto-approve",
		tooltipDescription,
		onToggle,
	}: Props = $props();

	const buttonClass = $derived(cn(busy && !active ? "opacity-70" : "", disabled || busy ? "cursor-default" : ""));

	const iconClass = $derived.by(() => {
		if (active) return "";
		if (disabled) return "text-muted-foreground/60";
		return "text-muted-foreground";
	});

	const buttonStyle = $derived.by(() => {
		if (!active) return undefined;
		return `color: ${Colors.purple};`;
	});

	function handleClick(): void {
		if (disabled || busy) return;
		onToggle();
	}
</script>

<Tooltip>
	<TooltipTrigger>
		{#snippet child({ props: triggerProps })}
			<Button
				{...triggerProps}
				variant="chromeIcon"
				size="chromeIcon"
				data-header-control
				title={title}
				aria-label={ariaLabel}
				active={active}
				disabled={disabled || busy}
				class={buttonClass}
				style={buttonStyle}
				aria-pressed={active}
				onclick={handleClick}
			>
				{#snippet children()}
					<ShieldCheck class={iconClass} size={12} weight={active ? "fill" : "bold"} />
				{/snippet}
			</Button>
		{/snippet}
	</TooltipTrigger>
	<TooltipContent class="max-w-xs">
		<div class="flex flex-col gap-0.5">
			<span class="font-medium">{title}</span>
			{#if tooltipDescription}
				<span class="text-muted-foreground">{tooltipDescription}</span>
			{/if}
		</div>
	</TooltipContent>
</Tooltip>
