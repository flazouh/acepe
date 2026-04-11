<!--
  AgentInputAutonomousToggle - Robot toggle button in the composer toolbar.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/autonomous-toggle-button.svelte.
  Uses plain title attribute instead of rich tooltip.
-->
<script lang="ts">
	import { Robot } from "phosphor-svelte";

	import { Colors } from "../../lib/colors.js";

	interface Props {
		active: boolean;
		disabled?: boolean;
		busy?: boolean;
		title?: string;
		ariaLabel?: string;
		onToggle: () => void;
	}

	let {
		active,
		disabled = false,
		busy = false,
		title = "Autonomous",
		ariaLabel = "Autonomous",
		onToggle,
	}: Props = $props();

	const buttonClass = $derived.by(() => {
		let classes =
			"flex h-7 w-7 items-center justify-center rounded-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

		if (active) {
			if (!busy) {
				classes += " autonomous-toggle--active-hover";
			}
		} else {
			if (!disabled) {
				classes += " text-muted-foreground";
				if (!busy) {
					classes += " hover:bg-accent/50 hover:text-foreground";
				}
			}
		}

		if (disabled && !active) {
			classes += " text-muted-foreground/60";
		}

		if (disabled || busy) {
			classes += " cursor-default";
		}

		if (busy && !active) {
			classes += " opacity-70";
		}

		return classes;
	});

	const iconClass = $derived.by(() => {
		if (active) return "";
		if (disabled) return "text-muted-foreground/60";
		return "text-muted-foreground";
	});

	const buttonStyle = $derived.by(() => {
		if (!active) return undefined;
		return `color: ${Colors.purple}; --autonomous-toggle-active-color: ${Colors.purple};`;
	});

	function handleClick(): void {
		if (disabled || busy) return;
		onToggle();
	}
</script>

<button
	type="button"
	onclick={handleClick}
	aria-label={ariaLabel}
	aria-pressed={active}
	aria-disabled={disabled || busy}
	class={buttonClass}
	style={buttonStyle}
	{title}
>
	<Robot class={iconClass} size={14} weight={active ? "fill" : "regular"} />
</button>

<style>
	.autonomous-toggle--active-hover:hover {
		background-color: color-mix(in srgb, var(--autonomous-toggle-active-color) 10%, transparent);
	}
</style>
