<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
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

	function cancelClose(): void {
		if (closeTimer === null) {
			return;
		}

		clearTimeout(closeTimer);
		closeTimer = null;
	}

	function requestOpen(): void {
		cancelClose();
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
</script>

{#if dismissed}
	{@render children()}
{:else}
	<TooltipPrimitive.Provider delayDuration={0} skipDelayDuration={0} disableHoverableContent={false}>
		<TooltipPrimitive.Root {open}>
			<TooltipPrimitive.Trigger asChild>
				{#snippet child({ props })}
					<span
						{...props}
						class={triggerClass}
						onpointermove={requestOpen}
						onpointerleave={requestClose}
					>
						{@render children()}
					</span>
				{/snippet}
			</TooltipPrimitive.Trigger>

			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					{side}
					{sideOffset}
					class="bg-popover border-border text-foreground z-[var(--overlay-z)] max-w-52 rounded-md border px-2.5 py-2 text-xs shadow-md"
					onpointerenter={cancelClose}
					onpointerleave={requestClose}
					onfocusin={cancelClose}
					onfocusout={requestClose}
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
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	</TooltipPrimitive.Provider>
{/if}
