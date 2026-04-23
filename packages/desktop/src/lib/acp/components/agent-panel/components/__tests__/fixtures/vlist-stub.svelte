<script lang="ts">
import type { Snippet } from "svelte";
import { onMount } from "svelte";

import {
	dataLengthHistory,
	getDefaultViewportSize,
	getRenderedItemAt,
	scrollToIndexCalls,
	shouldSuppressRenderedChildren,
} from "./vlist-stub-state.js";

type VListStubProps = {
	data: readonly unknown[];
	getKey?: (item: unknown, index: number) => string | number;
	onscroll?: (offset: number) => void;
	onscrollend?: () => void;
	children: Snippet<[item: unknown, index: number]>;
	bufferSize?: number;
	itemSize?: number;
	class?: string;
	style?: string;
};

let { data, getKey, children, onscroll, ...rest }: VListStubProps = $props();

function getSimulatedScrollSize(dataLength: number, itemSize: number | undefined): number {
	const resolvedItemSize = itemSize === undefined ? 120 : itemSize;
	return Math.max(320, dataLength * resolvedItemSize);
}

// Expose VListHandle-compatible methods for auto-scroll integration
let _scrollOffset = 0;
let _scrollSize = 320;
let _viewportSize = getDefaultViewportSize();

export function getScrollOffset(): number {
	return _scrollOffset;
}
export function getScrollSize(): number {
	return _scrollSize;
}
export function getViewportSize(): number {
	return _viewportSize;
}
export function scrollToIndex(
	index: number,
	opts?: { align?: "start" | "center" | "end" | "nearest" }
): void {
	scrollToIndexCalls.push({ index, options: opts });
	_scrollOffset = Math.max(0, _scrollSize - _viewportSize);
	onscroll?.(_scrollOffset);
}
export function scrollTo(offset: number): void {
	_scrollOffset = offset;
	onscroll?.(_scrollOffset);
}
export function scrollBy(offset: number): void {
	_scrollOffset += offset;
	onscroll?.(_scrollOffset);
}
export function getCache(): never {
	throw new Error("Not implemented in stub");
}
export function findItemIndex(_offset: number): number {
	return 0;
}
export function getItemOffset(_index: number): number {
	return 0;
}
export function getItemSize(_index: number): number {
	return 120;
}

// Test inspection helpers (not part of VListHandle)
onMount(() => {
	_scrollSize = getSimulatedScrollSize(data.length, rest.itemSize);
	dataLengthHistory.push(data.length);
});

$effect(() => {
	_scrollSize = getSimulatedScrollSize(data.length, rest.itemSize);
	dataLengthHistory.push(data.length);
});

export function _setScrollOffset(offset: number): void {
	_scrollOffset = offset;
}
export function _setScrollSize(size: number): void {
	_scrollSize = size;
}
export function _setViewportSize(size: number): void {
	_viewportSize = size;
}

function getRenderedItem(index: number): unknown {
	return getRenderedItemAt(data, index);
}

function getRenderedKey(index: number): string | number {
	const item = getRenderedItem(index);
	return getKey ? getKey(item, index) : index;
}
</script>

<div data-testid="vlist-stub" {...rest}>
	{#if !shouldSuppressRenderedChildren()}
		{#each data as _item, index (getRenderedKey(index))}
			{@const item = getRenderedItem(index)}
			{@render children(item, index)}
		{/each}
	{/if}
</div>
