<script lang="ts">
	import type { Snippet } from "svelte";

	interface DismissableTooltipProps {
		dismissed: boolean;
		onDismiss: () => void;
		title: string;
		description: string;
		side?: "top" | "right" | "bottom" | "left";
		sideOffset?: number;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		triggerClass?: string;
		children: Snippet;
	}

	let {
		dismissed,
		onDismiss,
		title,
		description,
		side = "right",
		sideOffset = 8,
		open = false,
		onOpenChange,
		triggerClass = "inline-flex",
		children,
	}: DismissableTooltipProps = $props();

	const CLOSE_DELAY_MS = 120;

	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let triggerElement: HTMLSpanElement | null = null;
	let contentPositionStyle = "";

	function cancelClose(): void {
		if (closeTimer === null) {
			return;
		}

		clearTimeout(closeTimer);
		closeTimer = null;
	}

	function requestOpen(): void {
		cancelClose();
		updateContentPosition();
		onOpenChange?.(true);
	}

	function requestClose(): void {
		cancelClose();
		closeTimer = setTimeout(() => {
			closeTimer = null;
			onOpenChange?.(false);
		}, CLOSE_DELAY_MS);
	}

	function handleDismiss(): void {
		cancelClose();
		onDismiss();
		onOpenChange?.(false);
	}

	function handleContentKeydown(event: KeyboardEvent): void {
		if (event.key !== "Escape") {
			return;
		}

		cancelClose();
		onOpenChange?.(false);
	}

	function updateContentPosition(): void {
		if (triggerElement === null) {
			return;
		}

		const rect = triggerElement.getBoundingClientRect();

		if (side === "top") {
			contentPositionStyle = [
				`left: ${rect.left + rect.width / 2}px`,
				`top: ${rect.top - sideOffset}px`,
				"transform: translate(-50%, -100%)",
			].join("; ");
			return;
		}

		if (side === "right") {
			contentPositionStyle = [
				`left: ${rect.right + sideOffset}px`,
				`top: ${rect.top + rect.height / 2}px`,
				"transform: translateY(-50%)",
			].join("; ");
			return;
		}

		if (side === "bottom") {
			contentPositionStyle = [
				`left: ${rect.left + rect.width / 2}px`,
				`top: ${rect.bottom + sideOffset}px`,
				"transform: translateX(-50%)",
			].join("; ");
			return;
		}

		contentPositionStyle = [
			`left: ${rect.left - sideOffset}px`,
			`top: ${rect.top + rect.height / 2}px`,
			"transform: translate(-100%, -50%)",
		].join("; ");
	}
</script>

{#if dismissed}
	{@render children()}
{:else}
	<span bind:this={triggerElement} class={triggerClass} onpointerleave={requestClose}>
		<span onpointermove={requestOpen}>
			{@render children()}
		</span>

		{#if open}
			<div
				class="bg-popover border-border text-foreground fixed z-[var(--overlay-z)] w-56 rounded-md border px-3 py-2 text-xs shadow-md"
				style={contentPositionStyle}
				onpointerenter={cancelClose}
				onpointerleave={requestClose}
				onkeydown={handleContentKeydown}
			>
				<p class="mb-1 font-semibold">{title}</p>
				<p class="text-muted-foreground mb-2">{description}</p>
				<div class="flex justify-end">
					<button
						type="button"
						class="text-foreground hover:text-foreground/80 cursor-pointer text-xs font-medium"
						aria-label="Dismiss this tip"
						onclick={handleDismiss}
					>
						Got it
					</button>
				</div>
			</div>
		{/if}
	</span>
{/if}
