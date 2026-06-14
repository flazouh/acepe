<!--
  AgentInputActiveModeChip - Dismissible pill showing the active composer mode.
-->
<script lang="ts">
	import { X } from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import AgentInputModeIcon from "./agent-input-mode-icon.svelte";
	import type { ModeIconKind } from "./agent-input-mode-selector-state.js";

	interface Props {
		label: string;
		iconKind?: ModeIconKind;
		disabled?: boolean;
		onDismiss?: () => void;
		onClick?: () => void;
	}

	let {
		label,
		iconKind = "unknown",
		disabled = false,
		onDismiss,
		onClick,
	}: Props = $props();

	function handleDismiss(event: MouseEvent): void {
		event.stopPropagation();
		if (!disabled) {
			onDismiss?.();
		}
	}

	function handleClick(): void {
		if (!disabled) {
			onClick?.();
		}
	}
</script>

<div
	class="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-border/50 bg-muted px-1 text-foreground/80"
	class:opacity-50={disabled}
	class:pointer-events-none={disabled}
>
	<button
		type="button"
		class="inline-flex items-center justify-center cursor-pointer rounded border-0 bg-transparent p-0.5 text-inherit outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
		disabled={disabled}
		aria-label={`Mode: ${label}`}
		onclick={handleClick}
	>
		<AgentInputModeIcon {iconKind} class="size-3.5 shrink-0" />
	</button>
	{#if onDismiss}
		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="h-5 w-5 shrink-0 rounded text-muted-foreground hover:text-foreground"
			disabled={disabled}
			aria-label={`Clear ${label} mode`}
			onclick={handleDismiss}
		>
			<X class="size-3" weight="bold" />
		</Button>
	{/if}
</div>
