<script lang="ts">
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import X from "phosphor-svelte/lib/X";
import { Button } from "$lib/components/ui/button/index.js";
import { cn } from "$lib/utils.js";

interface Props {
	/** Text to show in default state */
	label: string;
	/** Icon component to show in default state */
	icon?: typeof CheckCircle;
	/** Called when user confirms the action */
	onConfirm: () => void;
	/** Whether the action is in progress */
	isLoading?: boolean;
	/** Loading text */
	loadingLabel?: string;
	/** Additional classes for the container */
	class?: string;
	/** Disabled state */
	disabled?: boolean;
}

let {
	label,
	icon: Icon,
	onConfirm,
	isLoading = false,
	loadingLabel = "...",
	class: className = "",
	disabled = false,
}: Props = $props();

let isConfirming = $state(false);

function handleInitialClick() {
	if (disabled || isLoading) return;
	isConfirming = true;
}

function handleConfirm() {
	isConfirming = false;
	onConfirm();
}

function handleCancel() {
	isConfirming = false;
}

// Reset confirming state when loading starts
$effect(() => {
	if (isLoading) {
		isConfirming = false;
	}
});
</script>

{#if isLoading}
	<!-- Loading state -->
	<Button variant="ghost" size="sm" disabled class={cn("h-7 px-2 opacity-70", className)}>
		<span class="text-xs">{loadingLabel}</span>
	</Button>
{:else if isConfirming}
	<!-- Confirmation pill: [X Cancel | ✓ Confirm] -->
	<div
		class={cn(
			"inline-flex items-center rounded-md border border-border overflow-hidden",
			className
		)}
	>
		<button
			type="button"
			onclick={handleCancel}
			class="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
		>
			<X class="h-3.5 w-3.5" weight="bold" />
		</button>
		<div class="w-px h-5 bg-border"></div>
		<button
			type="button"
			onclick={handleConfirm}
			class="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
		>
			<CheckCircle class="h-3.5 w-3.5" weight="fill" />
		</button>
	</div>
{:else}
	<!-- Default state -->
	<Button
		variant="ghost"
		size="sm"
		class={cn("h-7 px-2", className)}
		{disabled}
		onclick={handleInitialClick}
	>
		{#if Icon}
			<Icon class="h-3.5 w-3.5" weight="bold" />
		{/if}
		<span class="ml-1 text-xs">{label}</span>
	</Button>
{/if}
