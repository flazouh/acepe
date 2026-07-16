<!--
  AgentInputActiveModeChip - Dismissible pill showing the active composer mode.
  Matches inline skill chip styling in the composer editor.
-->
<script lang="ts">
	import { ChipShell } from "../chip/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
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
		if (!disabled && onClick) {
			onClick();
		}
	}
</script>

<ChipShell
	density="inline"
	class="shrink-0 {disabled ? 'pointer-events-none opacity-50' : ''}"
	ariaLabel={`Mode: ${label}`}
	role="group"
>
	{#if onClick}
		<button
			type="button"
			class="inline-flex min-w-0 items-center gap-1.5 border-0 bg-transparent p-0 text-inherit outline-none cursor-pointer hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
			disabled={disabled}
			aria-label={`Mode: ${label}`}
			onclick={handleClick}
		>
			<AgentInputModeIcon {iconKind} class="size-3.5 shrink-0" />
			<span class="max-w-[120px] truncate leading-none text-foreground">{label}</span>
		</button>
	{:else}
		<AgentInputModeIcon {iconKind} class="size-3.5 shrink-0" />
		<span class="max-w-[120px] truncate leading-none text-foreground">{label}</span>
	{/if}
	{#if onDismiss}
		<button
			type="button"
			class="ml-0.5 cursor-pointer rounded-md p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
			disabled={disabled}
			aria-label={`Clear ${label} mode`}
			onclick={handleDismiss}
		>
			<HugeiconsIcon name="close" class="h-3 w-3" />
		</button>
	{/if}
</ChipShell>
