<!--
  AgentPanelTranscriptScrollControls - Compact setup-chip scroll jumps for the transcript.
  Sits at the top of the pre-composer card stack, aligned to the composer's top-right edge.
-->
<script lang="ts">
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";

	import { Button } from "../button/index.js";
	import { ButtonGroup } from "../button-group/index.js";
	import { SETUP_CHIP_ICON_CLASS } from "./agent-input-chip-classes.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		showScrollToTop?: boolean;
		showScrollToBottom?: boolean;
		onScrollToTop?: () => void;
		onScrollToBottom?: () => void;
		scrollToTopAriaLabel?: string;
		scrollToBottomAriaLabel?: string;
		centered?: boolean;
		widthClass?: string;
		class?: string;
	}

	let {
		showScrollToTop = false,
		showScrollToBottom = false,
		onScrollToTop,
		onScrollToBottom,
		scrollToTopAriaLabel = "Scroll to top",
		scrollToBottomAriaLabel = "Scroll to bottom",
		centered = false,
		widthClass = "max-w-[60%]",
		class: className = "",
	}: Props = $props();

	const showControls = $derived(showScrollToTop || showScrollToBottom);
	const showBothControls = $derived(showScrollToTop && showScrollToBottom);
	const scrollButtonSize = $derived<"icon-sm" | "icon-sm-narrow">(
		showBothControls ? "icon-sm-narrow" : "icon-sm"
	);

	function handleScrollToTop(event: MouseEvent): void {
		event.stopPropagation();
		onScrollToTop?.();
	}

	function handleScrollToBottom(event: MouseEvent): void {
		event.stopPropagation();
		onScrollToBottom?.();
	}
</script>

{#if showControls}
	<div
		data-testid="transcript-scroll-controls"
		class={cn("flex shrink-0 px-2 pt-0.5 pb-0.5", centered && "justify-center", className)}
	>
		<div class={cn("flex w-full justify-end", centered && widthClass)}>
			<ButtonGroup>
				{#if showScrollToTop}
					<Button
						variant="secondary"
						size={scrollButtonSize}
						aria-label={scrollToTopAriaLabel}
						onclick={handleScrollToTop}
					>
						<ArrowUp class={SETUP_CHIP_ICON_CLASS} aria-hidden="true" />
					</Button>
				{/if}
				{#if showScrollToBottom}
					<Button
						variant="secondary"
						size={scrollButtonSize}
						aria-label={scrollToBottomAriaLabel}
						onclick={handleScrollToBottom}
					>
						<ArrowDown class={SETUP_CHIP_ICON_CLASS} aria-hidden="true" />
					</Button>
				{/if}
			</ButtonGroup>
		</div>
	</div>
{/if}
