<!--
  AgentPanelTranscriptScrollControls - Compact scroll jumps for the transcript.
  Sits above the composer, aligned to the composer's top-right edge within the chat content column.
-->
<script lang="ts">
	import { Button } from "../button/index.js";
	import { ButtonGroup } from "../button-group/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import { cn } from "../../lib/utils.js";
	import AgentPanelContentColumnFrame from "./agent-panel-content-column-frame.svelte";

	interface Props {
		showScrollToTop?: boolean;
		showScrollToBottom?: boolean;
		hasUnreadBelow?: boolean;
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
		hasUnreadBelow = false,
		onScrollToTop,
		onScrollToBottom,
		scrollToTopAriaLabel = "Scroll to top",
		scrollToBottomAriaLabel = "Scroll to bottom",
		centered = false,
		widthClass = "max-w-[60%]",
		class: className = "",
	}: Props = $props();

	const showControls = $derived(showScrollToTop || showScrollToBottom);
	const effectiveScrollToBottomAriaLabel = $derived(
		hasUnreadBelow ? "Scroll to new messages" : scrollToBottomAriaLabel
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
	<AgentPanelContentColumnFrame
		{centered}
		{widthClass}
		class={cn("bg-transparent pt-0.5 pb-0.5", className)}
		innerClass="flex w-full justify-end"
	>
		<div data-testid="transcript-scroll-controls">
			<ButtonGroup>
				{#if showScrollToTop}
					<Button
						variant="secondary"
						size="icon"
						aria-label={scrollToTopAriaLabel}
						onclick={handleScrollToTop}
					>
						<RoundedIcon name="arrow-up" />
					</Button>
				{/if}
				{#if showScrollToBottom}
					<Button
						variant="secondary"
						size="icon"
						aria-label={effectiveScrollToBottomAriaLabel}
						data-unread-below={hasUnreadBelow ? "true" : undefined}
						class="relative"
						onclick={handleScrollToBottom}
					>
						<RoundedIcon name="arrow-up" class="rotate-180" />
						{#if hasUnreadBelow}
							<span
								class="absolute right-0 top-0 size-1.5 rounded-full bg-primary"
								aria-hidden="true"
							></span>
						{/if}
					</Button>
				{/if}
			</ButtonGroup>
		</div>
	</AgentPanelContentColumnFrame>
{/if}
