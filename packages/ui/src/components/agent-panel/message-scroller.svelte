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
		/** Accessible label for the jump-to-latest control (host-provided copy). */
		jumpToLatestLabel: string;
		/** Optional text shown on the jump pill (e.g. "New messages"). */
		jumpToLatestText?: string;
		/** Notified when follow/unread state changes (drives host-side affordances). */
		onFollowStateChange?: (state: { released: boolean; hasUnreadBelow: boolean }) => void;
		/** Hands the live controller to the host for imperative onSend/jumpToLatest. */
		onReady?: (controller: StickToBottomController) => void;
	}

	let {
		items,
		renderItem,
		ariaLabel,
		jumpToLatestLabel,
		jumpToLatestText,
		onFollowStateChange,
		onReady,
	}: Props = $props();

	let contentEl: HTMLElement | undefined = $state();
	let controller: StickToBottomController | undefined;
	let released = $state(false);
	let hasUnreadBelow = $state(false);

	const showJumpToLatest = $derived(released);

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
				released = state.released;
				hasUnreadBelow = state.hasUnreadBelow;
				onFollowStateChange?.(state);
			},
		});
		onReady?.(controller);
		return () => {
			controller?.destroy();
			controller = undefined;
		};
	}

	function handleJumpToLatest() {
		controller?.jumpToLatest();
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

	{#if showJumpToLatest}
		<button
			type="button"
			class={["message-scroller__jump", hasUnreadBelow && "has-unread"]}
			aria-label={jumpToLatestLabel}
			onclick={handleJumpToLatest}
		>
			{#if jumpToLatestText}<span>{jumpToLatestText}</span>{/if}
		</button>
	{/if}
</div>

<style>
	.message-scroller {
		position: relative;
		display: flex;
		min-height: 0;
		flex: 1 1 auto;
	}

	.message-scroller__viewport {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		outline: none;
	}

	.message-scroller__content {
		display: flex;
		flex-direction: column;
	}

	.message-scroller__jump {
		position: absolute;
		bottom: 0.75rem;
		left: 50%;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		cursor: pointer;
	}
</style>
