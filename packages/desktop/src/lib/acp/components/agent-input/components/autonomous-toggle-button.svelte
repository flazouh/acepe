<script lang="ts">
import { Colors } from "$lib/acp/utils/colors.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import Shield from "phosphor-svelte/lib/Shield";

interface AutonomousToggleButtonProps {
	readonly active: boolean;
	readonly disabled: boolean;
	readonly busy: boolean;
	readonly tooltip: string;
	readonly onToggle: () => Promise<void>;
}

let { active, disabled, busy, tooltip, onToggle }: AutonomousToggleButtonProps = $props();

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
	if (active) {
		return "";
	}

	if (disabled) {
		return "text-muted-foreground/60";
	}

	return "text-muted-foreground";
});

const buttonStyle = $derived.by(() => {
	if (!active) {
		return undefined;
	}

	return `color: ${Colors.red}; --autonomous-toggle-active-color: ${Colors.red};`;
});

function handleClick(): void {
	if (disabled || busy) {
		return;
	}

	void onToggle();
}
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props: triggerProps })}
			<button
				{...triggerProps}
				type="button"
				onclick={handleClick}
				aria-label="Autonomous"
				aria-pressed={active}
				aria-disabled={disabled || busy}
				class={buttonClass}
				style={buttonStyle}
			>
				<Shield class={iconClass} size={14} weight={active ? "fill" : "regular"} />
			</button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>
		<span>{tooltip}</span>
	</Tooltip.Content>
</Tooltip.Root>

<style>
	.autonomous-toggle--active-hover:hover {
		background-color: color-mix(
			in srgb,
			var(--autonomous-toggle-active-color) 10%,
			transparent
		);
	}
</style>