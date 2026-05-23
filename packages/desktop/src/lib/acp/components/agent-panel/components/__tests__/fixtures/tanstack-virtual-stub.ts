import { writable, type Readable } from "svelte/store";

import {
	dataLengthHistory,
	getDefaultViewportSize,
	measureCalls,
	measureElementCalls,
	recordScrollOffset,
	scrollToIndexCalls,
	shouldSuppressRenderedChildren,
	shouldUseIndexKeys,
} from "./transcript-virtualizer-state.js";

type VirtualItem = {
	key: string | number;
	index: number;
	start: number;
	size: number;
};

type VirtualizerOptions = {
	count?: number;
	getScrollElement?: () => HTMLDivElement | null;
	getItemKey?: (index: number) => string | number;
	estimateSize?: (index: number) => number;
	overscan?: number;
};

type VirtualizerStub = {
	setOptions(options: VirtualizerOptions): void;
	getTotalSize(): number;
	getVirtualItems(): VirtualItem[];
	measure(): void;
	measureElement(node: Element): void;
	scrollToIndex(index: number, options?: { align?: "start" | "center" | "end" }): void;
	scrollToOffset(offset: number): void;
	readonly scrollOffset: number;
	readonly scrollRect: { height: number };
};

function resolveRowSize(options: VirtualizerOptions, index: number): number {
	return options.estimateSize?.(index) ?? 120;
}

function recordDataLength(count: number): void {
	dataLengthHistory.push(count);
}

function dispatchScroll(viewport: HTMLDivElement | null): void {
	if (viewport === null) {
		return;
	}
	viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
}

export function createVirtualizer(initialOptions: VirtualizerOptions): Readable<VirtualizerStub> {
	let options = initialOptions;
	let scrollOffset = 0;
	const store = writable<VirtualizerStub>();
	const instance: VirtualizerStub = {
		setOptions(nextOptions) {
			options = { ...options, ...nextOptions };
			recordDataLength(options.count ?? 0);
			store.set(instance);
		},
		getTotalSize() {
			const count = options.count ?? 0;
			let totalSize = 0;
			for (let index = 0; index < count; index += 1) {
				totalSize += resolveRowSize(options, index);
			}
			return Math.max(320, totalSize);
		},
		getVirtualItems() {
			if (shouldSuppressRenderedChildren()) {
				return [];
			}
			const count = options.count ?? 0;
			const items: VirtualItem[] = [];
			let start = 0;
			for (let index = 0; index < count; index += 1) {
				const size = resolveRowSize(options, index);
				items.push({
					index,
					key: shouldUseIndexKeys() ? index : (options.getItemKey?.(index) ?? index),
					start,
					size,
				});
				start += size;
			}
			return items;
		},
		measure() {
			measureCalls.push("measure");
			return;
		},
		measureElement(node) {
			measureElementCalls.push(
				node instanceof HTMLElement
					? (node.dataset.entryKey ?? node.dataset.index ?? node.tagName)
					: "element"
			);
			return;
		},
		scrollToIndex(index, scrollOptions) {
			scrollToIndexCalls.push({ index, options: scrollOptions });
			const viewport = options.getScrollElement?.() ?? null;
			scrollOffset = Math.max(0, instance.getTotalSize() - getDefaultViewportSize());
			if (viewport !== null) {
				viewport.scrollTop = scrollOffset;
			}
			recordScrollOffset(scrollOffset);
			dispatchScroll(viewport);
			store.set(instance);
		},
		scrollToOffset(offset) {
			const viewport = options.getScrollElement?.() ?? null;
			scrollOffset = offset;
			if (viewport !== null) {
				viewport.scrollTop = offset;
			}
			recordScrollOffset(scrollOffset);
			dispatchScroll(viewport);
			store.set(instance);
		},
		get scrollOffset() {
			return scrollOffset;
		},
		get scrollRect() {
			return { height: getDefaultViewportSize() };
		},
	};
	recordDataLength(options.count ?? 0);
	store.set(instance);
	return store;
}
