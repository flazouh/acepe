<script lang="ts">
	import type { Snippet } from "svelte";

	import {
		type StickToBottomController,
		createStickToBottomController,
	} from "./stick-to-bottom-effects.js";
	import MessageScrollerItem from "./message-scroller-item.svelte";
	import type { MessageScrollerItem as Item } from "./message-scroller-types.js";

	interface Props {
		items: readonly Item[];
		/** Renders one row's content; receives the item. */
		renderItem: Snippet<[Item]>;
		/** Accessible name for the scrollable transcript region (host-provided copy). */
		ariaLabel: string;
		/** Notified when follow/unread state changes (drives host-side affordances). */
		onFollowStateChange?: (state: { released: boolean; hasUnreadBelow: boolean }) => void;
		/** Notified when top/bottom edge state changes (drives host scroll controls). */
		onEdgeStateChange?: (state: { atTop: boolean; atBottom: boolean }) => void;
		/** Hands the live controller to the host for imperative onSend/jumpToLatest. */
		onReady?: (controller: StickToBottomController) => void;
	}

	let {
		items,
		renderItem,
		ariaLabel,
		onFollowStateChange,
		onEdgeStateChange,
		onReady,
	}: Props = $props();

	let contentEl: HTMLElement | undefined = $state();
	let controller: StickToBottomController | undefined;

	function resolveRowTop(rowId: string): number | null {
		const el = contentEl?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"]`);
		return el ? el.offsetTop : null;
	}

	// Topmost anchor-eligible row at or below the current scroll position — the
	// row held stationary while the reader is scrolled up and content above grows.
	function resolveAnchor(): { rowId: string; topPx: number } | null {
		if (!contentEl) {
			return null;
		}
		const scrollTop = (contentEl.parentElement?.scrollTop ?? 0);
		const candidates = contentEl.querySelectorAll<HTMLElement>("[data-anchor][data-row-id]");
		for (const el of candidates) {
			if (el.offsetTop >= scrollTop) {
				const rowId = el.getAttribute("data-row-id");
				return rowId ? { rowId, topPx: el.offsetTop } : null;
			}
		}
		return null;
	}

	function attachController(node: HTMLElement) {
		controller = createStickToBottomController(node, {
			content: contentEl,
			resolveAnchor,
			resolveRowTop,
			onStateChange: (state) => {
				onFollowStateChange?.(state);
			},
			onEdgeStateChange: (state) => {
				onEdgeStateChange?.(state);
			},
		});
		onReady?.(controller);
		return () => {
			controller?.destroy();
			controller = undefined;
		};
	}

</script>

<div class="message-scroller">
	<!--
	  The scroll container is intentionally focusable so keyboard scrolling
	  (PageDown / arrows) works and releases follow like a wheel/touch scroll —
	  an accessibility requirement, not a noninteractive decoration.
	-->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="message-scroller__viewport"
		tabindex="0"
		role="log"
		aria-live="polite"
		aria-label={ariaLabel}
		{@attach attachController}
	>
		<div class="message-scroller__content" bind:this={contentEl}>
			{#each items as item (item.key)}
				<MessageScrollerItem
					rowId={item.rowId}
					estimatePx={item.estimatePx}
					isActiveTail={item.isActiveTail}
					anchorEligible={item.anchorEligible}
				>
					{@render renderItem(item)}
				</MessageScrollerItem>
			{/each}
		</div>
	</div>
</div>

<style>
	.message-scroller {
		position: relative;
		display: flex;
		min-height: 0;
		min-width: 0;
		flex: 1 1 auto;
		width: 100%;
		max-width: 100%;
	}

	.message-scroller__viewport {
		flex: 1 1 auto;
		min-height: 0;
		min-width: 0;
		width: 100%;
		max-width: 100%;
		overflow-y: scroll;
		overflow-x: hidden;
		scrollbar-gutter: stable;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--muted-foreground) 60%, transparent)
			color-mix(in srgb, var(--border) 12%, transparent);
		outline: none;
	}

	.message-scroller__content {
		display: flex;
		flex-direction: column;
		min-width: 0;
		width: 100%;
		max-width: 100%;
	}

	.message-scroller__viewport::-webkit-scrollbar {
		width: 0.75rem;
	}

	.message-scroller__viewport::-webkit-scrollbar-track {
		background: color-mix(in srgb, var(--border) 12%, transparent);
		border-radius: 9999px;
	}

	.message-scroller__viewport::-webkit-scrollbar-thumb {
		min-height: 2rem;
		border: 0.1875rem solid transparent;
		border-radius: 9999px;
		background-color: color-mix(in srgb, var(--muted-foreground) 58%, transparent);
		background-clip: content-box;
	}

	.message-scroller__viewport:hover::-webkit-scrollbar-thumb,
	.message-scroller__viewport:focus-visible::-webkit-scrollbar-thumb {
		background-color: color-mix(in srgb, var(--muted-foreground) 74%, transparent);
	}
</style>
