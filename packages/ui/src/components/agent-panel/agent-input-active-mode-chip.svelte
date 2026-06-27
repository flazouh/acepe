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
	class="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card px-1 py-0 text-foreground"
	class:opacity-50={disabled}
	class:pointer-events-none={disabled}
>
	<button
		type="button"
		class="inline-flex min-w-0 items-center gap-1 rounded-md border-0 bg-transparent px-0.5 py-0 text-inherit outline-none cursor-pointer hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
		disabled={disabled}
		aria-label={`Mode: ${label}`}
		onclick={handleClick}
	>
		<AgentInputModeIcon {iconKind} class="size-3.5 shrink-0" />
		<span class="max-w-24 truncate text-xs font-medium leading-none">{label}</span>
	</button>
	{#if onDismiss}
		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="h-4 w-4 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
			disabled={disabled}
			aria-label={`Clear ${label} mode`}
			onclick={handleDismiss}
		>
			<X class="size-3" weight="bold" />
		</Button>
	{/if}
</div>
