<script lang="ts">
	import { CaretDown } from "phosphor-svelte";
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
		/** Accessible label for the jump-to-latest control (host-provided copy). */
		jumpToLatestLabel: string;
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
		jumpToLatestLabel,
		onFollowStateChange,
		onEdgeStateChange,
		onReady,
	}: Props = $props();

	let contentEl: HTMLElement | undefined = $state();
	let viewportEl: HTMLElement | undefined = $state();
	let controller: StickToBottomController | undefined;
	let released = $state(false);
	let hasUnreadBelow = $state(false);
	let canScroll = $state(false);
	let scrollThumbTopPct = $state(0);
	let scrollThumbHeightPct = $state(100);

	const showJumpToLatest = $derived(released);
	const showScrollIndicator = $derived(canScroll && released);

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
		viewportEl = node;
		let isAlive = true;
		let frameId: number | null = null;
		const resizeObserver =
			typeof ResizeObserver === "function"
				? new ResizeObserver(() => {
						scheduleScrollbarRefresh();
					})
				: null;

		function scheduleScrollbarRefresh() {
			if (frameId !== null) {
				return;
			}
			frameId = requestAnimationFrame(() => {
				frameId = null;
				refreshScrollbar();
			});
		}

		resizeObserver?.observe(node);
		queueMicrotask(() => {
			if (!isAlive) {
				return;
			}
			if (contentEl !== undefined) {
				resizeObserver?.observe(contentEl);
			}
			scheduleScrollbarRefresh();
		});
		controller = createStickToBottomController(node, {
			content: contentEl,
			resolveAnchor,
			resolveRowTop,
			onStateChange: (state) => {
				released = state.released;
				hasUnreadBelow = state.hasUnreadBelow;
				onFollowStateChange?.(state);
			},
			onEdgeStateChange: (state) => {
				onEdgeStateChange?.(state);
			},
	});
		onReady?.(controller);
		scheduleScrollbarRefresh();
		return () => {
			isAlive = false;
			if (frameId !== null) {
				cancelAnimationFrame(frameId);
			}
			resizeObserver?.disconnect();
			controller?.destroy();
			controller = undefined;
			if (viewportEl === node) {
				viewportEl = undefined;
			}
		};
	}

	function handleJumpToLatest() {
		controller?.jumpToLatest();
	}

	function handleViewportScroll() {
		refreshScrollbar();
	}

	function refreshScrollbar() {
		if (viewportEl === undefined) {
			return;
		}
		const scrollablePx = viewportEl.scrollHeight - viewportEl.clientHeight;
		const nextCanScroll = scrollablePx > 1;
		if (canScroll !== nextCanScroll) {
			canScroll = nextCanScroll;
		}
		if (!nextCanScroll) {
			setScrollThumb(0, 100);
			return;
		}
		const nextHeightPct = Math.max(
			12,
			Math.min(100, (viewportEl.clientHeight / viewportEl.scrollHeight) * 100)
		);
		const nextTopPct = (viewportEl.scrollTop / scrollablePx) * (100 - nextHeightPct);
		setScrollThumb(nextTopPct, nextHeightPct);
	}

	function setScrollThumb(nextTopPct: number, nextHeightPct: number) {
		const roundedTop = Math.round(nextTopPct * 100) / 100;
		const roundedHeight = Math.round(nextHeightPct * 100) / 100;
		if (scrollThumbTopPct !== roundedTop) {
			scrollThumbTopPct = roundedTop;
		}
		if (scrollThumbHeightPct !== roundedHeight) {
			scrollThumbHeightPct = roundedHeight;
		}
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
		bind:this={viewportEl}
		onscroll={handleViewportScroll}
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

	{#if showJumpToLatest}
		<button
			type="button"
			class={["message-scroller__jump", hasUnreadBelow && "has-unread"]}
			aria-label={jumpToLatestLabel}
			onclick={handleJumpToLatest}
		>
			<CaretDown size={15} weight="bold" aria-hidden="true" />
		</button>
	{/if}

	{#if showScrollIndicator}
		<div class="message-scroller__scrollbar" aria-hidden="true">
			<div
				class="message-scroller__scrollbar-thumb"
				style={`height: ${scrollThumbHeightPct}%; top: ${scrollThumbTopPct}%;`}
			></div>
		</div>
	{/if}
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

	.message-scroller__jump {
		position: absolute;
		bottom: 0.75rem;
		left: 50%;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
		border-radius: 9999px;
		background: color-mix(in srgb, var(--background) 90%, transparent);
		color: var(--foreground);
		box-shadow: 0 8px 24px color-mix(in srgb, #000 14%, transparent);
		cursor: pointer;
	}

	.message-scroller__jump.has-unread {
		border-color: color-mix(in srgb, var(--primary) 44%, var(--border));
		color: var(--primary);
	}

	.message-scroller__scrollbar {
		position: absolute;
		top: 0.5rem;
		right: 0.25rem;
		bottom: 0.5rem;
		z-index: 2;
		width: 0.375rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--border) 18%, transparent);
		pointer-events: none;
	}

	.message-scroller__scrollbar-thumb {
		position: absolute;
		left: 0;
		right: 0;
		min-height: 2rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--muted-foreground) 76%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, #000 18%, transparent);
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
