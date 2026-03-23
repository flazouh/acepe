<script lang="ts">
import type { Snippet } from "svelte";

import { cn } from "$lib/utils.js";

interface Props {
	open: boolean;
	ariaLabel: string;
	children: Snippet;
	keepMounted?: boolean;
	panelClass?: string;
	position?: "fixed" | "absolute";
	onClose?: () => void;
}

let {
	open,
	ariaLabel,
	children,
	keepMounted = false,
	panelClass = "",
	position = "fixed",
	onClose,
}: Props = $props();

const overlayClass = $derived(
	open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
);

function handleBackdropClick(event: MouseEvent): void {
	if (event.target !== event.currentTarget) return;
	onClose?.();
}

function handleKeydown(event: KeyboardEvent): void {
	if (event.key !== "Escape") return;
	event.stopPropagation();
	onClose?.();
}

function stopPropagation(event: Event): void {
	event.stopPropagation();
}
</script>

{#if open || keepMounted}
	<div
		class={cn(
			position === "fixed" ? "fixed" : "absolute",
			"inset-0 z-[9997] bg-black/55 p-2 transition-opacity duration-200 sm:p-4 md:p-5",
			overlayClass
		)}
		role="dialog"
		aria-label={ariaLabel}
		aria-hidden={!open}
		aria-modal={open ? "true" : undefined}
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div class="mx-auto flex h-full w-full items-center justify-center">
			<div
				class={cn(
					"flex h-full w-full max-h-[860px] max-w-[1320px] overflow-hidden rounded-[1.25rem] border border-border/60 bg-background shadow-[0_24px_64px_rgba(0,0,0,0.38)]",
					panelClass
				)}
				role="presentation"
				onclick={stopPropagation}
				onkeydown={stopPropagation}
			>
				{@render children()}
			</div>
		</div>
	</div>
{/if}
