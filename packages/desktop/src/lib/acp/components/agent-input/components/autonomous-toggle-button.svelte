<script lang="ts">
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

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
		"flex h-7 items-center rounded-none px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

	if (active) {
		classes += " bg-destructive text-destructive-foreground";
		if (!busy) {
			classes += " hover:bg-destructive/90";
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
				aria-pressed={active}
				aria-disabled={disabled || busy}
				class={buttonClass}
			>
				Autonomous
			</button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>
		<span>{tooltip}</span>
	</Tooltip.Content>
</Tooltip.Root>