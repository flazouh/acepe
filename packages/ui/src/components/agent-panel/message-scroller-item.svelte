<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	itemKey: string;
	itemIndex: number;
	rowId: string;
	estimatePx: number;
	sourceEstimatePx: number;
	measuredHeightPx: number | null;
	isActiveTail: boolean;
	anchorEligible: boolean;
	measureSize?: boolean;
	onSizeChange?: (itemKey: string, itemIndex: number, heightPx: number) => void;
	children: Snippet;
}

let {
	itemKey,
	itemIndex,
	rowId,
	estimatePx,
	sourceEstimatePx,
	measuredHeightPx,
	isActiveTail,
	anchorEligible,
	measureSize = true,
	onSizeChange,
	children,
}: Props = $props();

const estimateSource = $derived(
	measuredHeightPx === null ? "static" : "measured",
);
const staticEstimateErrorPx = $derived(
	measuredHeightPx === null
		? null
		: Math.abs(sourceEstimatePx - measuredHeightPx),
);

function readResizeEntryHeight(entry: ResizeObserverEntry): number | null {
	const contentBoxSize = Array.isArray(entry.contentBoxSize)
		? entry.contentBoxSize[0]
		: entry.contentBoxSize;
	if (
		contentBoxSize !== undefined &&
		Number.isFinite(contentBoxSize.blockSize) &&
		contentBoxSize.blockSize > 0
	) {
		return contentBoxSize.blockSize;
	}
	if (
		Number.isFinite(entry.contentRect.height) &&
		entry.contentRect.height > 0
	) {
		return entry.contentRect.height;
	}
	return null;
}

function measureItem(node: HTMLElement) {
	if (typeof ResizeObserver !== "function") {
		return () => {};
	}
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry === undefined) {
			return;
		}
		const heightPx = readResizeEntryHeight(entry);
		if (heightPx === null) {
			return;
		}
		onSizeChange?.(itemKey, itemIndex, heightPx);
	});
	observer.observe(node);
	return () => {
		observer.disconnect();
	};
}
</script>

<!--
  One mounted transcript row. The parent virtualizer decides which rows exist;
  ResizeObserver measurements feed the next virtual layout estimate. `data-anchor`
  marks rows the JS scroll-anchoring may hold stationary (WebKit has no
  `overflow-anchor`).
-->
<div
	class={["message-scroller-item", isActiveTail && "is-active-tail"]}
	style:--cv-estimate-px="{estimatePx}px"
	data-row-id={rowId}
	data-row-index={itemIndex}
	data-cv-estimate-px={estimatePx}
	data-cv-estimate-source={estimateSource}
	data-measured-height-px={measuredHeightPx === null ? undefined : measuredHeightPx}
	data-static-estimate-error-px={
		staticEstimateErrorPx === null ? undefined : staticEstimateErrorPx
	}
	data-anchor={anchorEligible ? "" : undefined}
	{@attach measureSize && measureItem}
>
	{@render children()}
</div>

<style>
	.message-scroller-item {
		min-width: 0;
		width: 100%;
		max-width: 100%;
		contain: layout style paint;
		overflow-anchor: none;
	}
</style>
