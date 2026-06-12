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
	class="inline-flex h-7 max-w-36 shrink-0 items-center gap-1 rounded-full border border-border/60 bg-muted/50 pl-2 pr-0.5 text-xs font-medium text-foreground"
	class:opacity-50={disabled}
	class:pointer-events-none={disabled}
>
	<button
		type="button"
		class="inline-flex min-w-0 flex-1 items-center gap-1 truncate cursor-pointer rounded-full border-0 bg-transparent p-0 text-inherit outline-none focus-visible:ring-1 focus-visible:ring-ring"
		disabled={disabled}
		aria-label={`Mode: ${label}`}
		onclick={handleClick}
	>
		<AgentInputModeIcon {iconKind} class="size-3 shrink-0" />
		<span class="truncate">{label}</span>
	</button>
	{#if onDismiss}
		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="h-5 w-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
			disabled={disabled}
			aria-label={`Clear ${label} mode`}
			onclick={handleDismiss}
		>
			<X class="size-3" weight="bold" />
		</Button>
	{/if}
</div>
