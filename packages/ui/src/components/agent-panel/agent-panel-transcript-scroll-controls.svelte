<!--
  AgentPanelTranscriptScrollControls - Compact setup-chip scroll jumps for the transcript.
  Sits at the top of the pre-composer card stack, aligned to the composer's top-right edge.
-->
<script lang="ts">
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";

	import { ButtonGroup } from "../button-group/index.js";
	import {
		FUSED_CONTROL_CHIP_GROUP_CLASS,
		FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS,
		FUSED_CONTROL_SETUP_GROUPED_ICON_CHIP_BUTTON_CLASS,
		FUSED_CONTROL_SETUP_GROUPED_ICON_TRAILING_BUTTON_CLASS,
		FUSED_CONTROL_SETUP_ICON_CHIP_BUTTON_CLASS,
	} from "../panel-header/index.js";
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
	const scrollTopButtonClass = $derived(
		showBothControls
			? FUSED_CONTROL_SETUP_GROUPED_ICON_CHIP_BUTTON_CLASS
			: FUSED_CONTROL_SETUP_ICON_CHIP_BUTTON_CLASS
	);
	const scrollBottomButtonClass = $derived(
		showBothControls
			? FUSED_CONTROL_SETUP_GROUPED_ICON_TRAILING_BUTTON_CLASS
			: FUSED_CONTROL_SETUP_ICON_CHIP_BUTTON_CLASS
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
			<ButtonGroup
				class={cn(
					FUSED_CONTROL_CHIP_GROUP_CLASS,
					"min-h-[23px] [&_[data-slot=button]]:min-h-[23px]"
				)}
			>
				{#if showScrollToTop}
					<button
						type="button"
						data-slot="button"
						class={scrollTopButtonClass}
						aria-label={scrollToTopAriaLabel}
						onclick={handleScrollToTop}
					>
						<ArrowUp class={FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS} aria-hidden="true" />
					</button>
				{/if}
				{#if showScrollToBottom}
					<button
						type="button"
						data-slot="button"
						class={scrollBottomButtonClass}
						aria-label={scrollToBottomAriaLabel}
						onclick={handleScrollToBottom}
					>
						<ArrowDown class={FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS} aria-hidden="true" />
					</button>
				{/if}
			</ButtonGroup>
		</div>
	</div>
{/if}
