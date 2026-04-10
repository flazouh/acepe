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
	const TOOLTIP_WIDTH_PX = 224;
	const VIEWPORT_PADDING_PX = 12;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let triggerElement = $state<HTMLSpanElement | null>(null);
	let contentElement = $state<HTMLDivElement | null>(null);
	let contentPositionStyle = $state("");

	function portalToBody(node: HTMLElement): { destroy: () => void } {
		document.body.appendChild(node);

		return {
			destroy(): void {
				node.remove();
			},
		};
	}

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

	function handleTriggerMouseleave(event: MouseEvent): void {
		if (contentElement !== null && event.relatedTarget instanceof Node && contentElement.contains(event.relatedTarget)) {
			return;
		}

		requestClose();
	}

	function handleTriggerFocusout(event: FocusEvent): void {
		if (
			contentElement !== null &&
			event.relatedTarget instanceof Node &&
			contentElement.contains(event.relatedTarget)
		) {
			return;
		}

		requestClose();
	}

	function handleContentMouseleave(event: MouseEvent): void {
		if (triggerElement !== null && event.relatedTarget instanceof Node && triggerElement.contains(event.relatedTarget)) {
			return;
		}

		requestClose();
	}

	function handleContentFocusout(event: FocusEvent): void {
		if (
			triggerElement !== null &&
			event.relatedTarget instanceof Node &&
			triggerElement.contains(event.relatedTarget)
		) {
			return;
		}

		requestClose();
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
		const maxLeft = Math.max(VIEWPORT_PADDING_PX, window.innerWidth - TOOLTIP_WIDTH_PX - VIEWPORT_PADDING_PX);
		const clampLeft = (value: number): number =>
			Math.min(Math.max(value, VIEWPORT_PADDING_PX), maxLeft);

		if (side === "top") {
			contentPositionStyle = [
				`left: ${clampLeft(rect.left + rect.width / 2 - TOOLTIP_WIDTH_PX / 2)}px`,
				`top: ${rect.top - sideOffset}px`,
				"transform: translateY(-100%)",
			].join("; ");
			return;
		}

		if (side === "right") {
			contentPositionStyle = [
				`left: ${clampLeft(rect.right + sideOffset)}px`,
				`top: ${rect.top + rect.height / 2}px`,
				"transform: translateY(-50%)",
			].join("; ");
			return;
		}

		if (side === "bottom") {
			contentPositionStyle = [
				`left: ${clampLeft(rect.left + rect.width / 2 - TOOLTIP_WIDTH_PX / 2)}px`,
				`top: ${rect.bottom + sideOffset}px`,
				"transform: none",
			].join("; ");
			return;
		}

		contentPositionStyle = [
			`left: ${clampLeft(rect.left - sideOffset - TOOLTIP_WIDTH_PX)}px`,
			`top: ${rect.top + rect.height / 2}px`,
			"transform: translateY(-50%)",
		].join("; ");
	}
</script>

{#if !dismissed}
	<span
		bind:this={triggerElement}
		class={triggerClass}
		role="presentation"
		onpointerenter={requestOpen}
		onpointerleave={handleTriggerMouseleave}
		onfocusin={requestOpen}
		onfocusout={handleTriggerFocusout}
	>
		{@render children()}

		{#if open}
			<div
				bind:this={contentElement}
				use:portalToBody
				role="tooltip"
				class="bg-popover border-border text-foreground fixed z-[9999] w-56 rounded-md border px-3 py-2 text-xs shadow-md"
				style={contentPositionStyle}
				onpointerenter={cancelClose}
				onpointerleave={handleContentMouseleave}
				onfocusout={handleContentFocusout}
			>
				<p class="mb-1 font-semibold">{title}</p>
				<p class="text-muted-foreground mb-2">{description}</p>
				<div class="flex justify-end">
					<button
						type="button"
						class="text-foreground hover:text-foreground/80 cursor-pointer text-xs font-medium"
						aria-label="Dismiss this tip"
						onclick={handleDismiss}
						onkeydown={handleContentKeydown}
					>
						Got it
					</button>
				</div>
			</div>
		{/if}
	</span>
{/if}
