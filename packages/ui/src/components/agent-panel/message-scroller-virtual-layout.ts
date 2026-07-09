import {
	createArrayMessageScrollerItemSource,
	type MessageScrollerItem,
	type MessageScrollerItemSource,
} from "./message-scroller-types.js";

const MIN_ROW_HEIGHT_PX = 1;

export type MessageScrollerVirtualRowTop = {
	readonly rowId: string;
	readonly topPx: number;
};

export type MessageScrollerVirtualOffsets = ArrayLike<number>;

export type MessageScrollerVirtualLayout = {
	readonly offsets: MessageScrollerVirtualOffsets;
	readonly totalPx: number;
};

export type MessageScrollerMeasuredHeight = {
	readonly itemKey: string;
	readonly heightPx: number;
};

export type MessageScrollerVirtualWindow = {
	readonly items: readonly MessageScrollerItem[];
	readonly startIndex: number;
	readonly endIndex: number;
	readonly beforePx: number;
	readonly afterPx: number;
	readonly totalPx: number;
};

function normalizeRowHeightPx(heightPx: number): number {
	if (!Number.isFinite(heightPx)) {
		return MIN_ROW_HEIGHT_PX;
	}
	return Math.max(MIN_ROW_HEIGHT_PX, heightPx);
}

function sortedMeasuredIndexes(
	measuredHeightsByIndex: ReadonlyMap<number, MessageScrollerMeasuredHeight>
): readonly number[] {
	const indexes: number[] = [];
	for (const index of measuredHeightsByIndex.keys()) {
		if (Number.isInteger(index) && index >= 0) {
			indexes.push(index);
		}
	}
	indexes.sort((left, right) => left - right);
	return indexes;
}

function resolveIndexedMeasuredRowHeightPx(
	itemSource: MessageScrollerItemSource,
	index: number,
	measuredHeightsByIndex: ReadonlyMap<number, MessageScrollerMeasuredHeight>
): number | undefined {
	const indexedMeasurement = measuredHeightsByIndex.get(index);
	if (indexedMeasurement !== undefined && itemSource.getKey(index) === indexedMeasurement.itemKey) {
		return indexedMeasurement.heightPx;
	}
	return undefined;
}

function buildRowOffsets(
	itemSource: MessageScrollerItemSource,
	measuredHeightsByKey: ReadonlyMap<string, number>,
	measuredHeightsByIndex: ReadonlyMap<number, MessageScrollerMeasuredHeight>,
	useMeasuredHeightsByKey: boolean
): MessageScrollerVirtualOffsets {
	const offsets = new Float64Array(itemSource.length + 1);
	const measuredIndexes = sortedMeasuredIndexes(measuredHeightsByIndex);
	const useIndexedMeasuredHeights = measuredIndexes.length > 0;
	const useKeyedMeasuredHeights = useMeasuredHeightsByKey && measuredHeightsByKey.size > 0;
	let measuredIndexCursor = 0;
	offsets[0] = 0;
	for (let index = 0; index < itemSource.length; index += 1) {
		let heightPx: number | undefined;
		if (useIndexedMeasuredHeights) {
			while (
				measuredIndexCursor < measuredIndexes.length &&
				(measuredIndexes[measuredIndexCursor] ?? 0) < index
			) {
				measuredIndexCursor += 1;
			}
			if (measuredIndexes[measuredIndexCursor] === index) {
				heightPx = resolveIndexedMeasuredRowHeightPx(itemSource, index, measuredHeightsByIndex);
			}
		}
		if (heightPx === undefined && useKeyedMeasuredHeights) {
			heightPx = measuredHeightsByKey.get(itemSource.getKey(index) ?? "");
		}
		offsets[index + 1] = offsets[index] + normalizeRowHeightPx(heightPx ?? itemSource.getEstimatePx(index));
	}
	return offsets;
}

export function createMessageScrollerVirtualLayoutFromSource(input: {
	readonly itemSource: MessageScrollerItemSource;
	readonly measuredHeightsByKey: ReadonlyMap<string, number>;
	readonly measuredHeightsByIndex?: ReadonlyMap<number, MessageScrollerMeasuredHeight>;
	readonly useMeasuredHeightsByKey?: boolean;
}): MessageScrollerVirtualLayout {
	const offsets = buildRowOffsets(
		input.itemSource,
		input.measuredHeightsByKey,
		input.measuredHeightsByIndex ?? new Map(),
		input.useMeasuredHeightsByKey ?? true
	);
	return {
		offsets,
		totalPx: offsets[input.itemSource.length] ?? 0,
	};
}

export function createMessageScrollerVirtualLayout(input: {
	readonly items: readonly MessageScrollerItem[];
	readonly measuredHeightsByKey: ReadonlyMap<string, number>;
}): MessageScrollerVirtualLayout {
	return createMessageScrollerVirtualLayoutFromSource({
		itemSource: createArrayMessageScrollerItemSource(input.items),
		measuredHeightsByKey: input.measuredHeightsByKey,
	});
}

function findStartIndex(
	offsets: MessageScrollerVirtualOffsets,
	itemCount: number,
	windowTopPx: number
): number {
	let low = 0;
	let high = itemCount;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if ((offsets[mid + 1] ?? 0) < windowTopPx) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

function findEndIndex(
	offsets: MessageScrollerVirtualOffsets,
	itemCount: number,
	startIndex: number,
	windowBottomPx: number
): number {
	let low = startIndex;
	let high = itemCount;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if ((offsets[mid] ?? 0) <= windowBottomPx) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

function findFirstOffsetAtOrAfter(
	offsets: MessageScrollerVirtualOffsets,
	itemCount: number,
	targetPx: number
): number {
	let low = 0;
	let high = itemCount;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if ((offsets[mid] ?? 0) < targetPx) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

export function createMessageScrollerVirtualWindowFromLayout(input: {
	readonly items: readonly MessageScrollerItem[];
	readonly layout: MessageScrollerVirtualLayout;
	readonly scrollTopPx: number;
	readonly viewportHeightPx: number;
	readonly overscanPx: number;
	readonly overscanBeforePx?: number;
	readonly overscanAfterPx?: number;
	readonly virtualizationThreshold: number;
}): MessageScrollerVirtualWindow {
	return createMessageScrollerVirtualWindowFromSourceLayout({
		itemSource: createArrayMessageScrollerItemSource(input.items),
		layout: input.layout,
		scrollTopPx: input.scrollTopPx,
		viewportHeightPx: input.viewportHeightPx,
		overscanPx: input.overscanPx,
		overscanBeforePx: input.overscanBeforePx,
		overscanAfterPx: input.overscanAfterPx,
		virtualizationThreshold: input.virtualizationThreshold,
	});
}

export function createMessageScrollerVirtualWindowFromSourceLayout(input: {
	readonly itemSource: MessageScrollerItemSource;
	readonly layout: MessageScrollerVirtualLayout;
	readonly scrollTopPx: number;
	readonly viewportHeightPx: number;
	readonly overscanPx: number;
	readonly overscanBeforePx?: number;
	readonly overscanAfterPx?: number;
	readonly virtualizationThreshold: number;
}): MessageScrollerVirtualWindow {
	if (input.itemSource.length <= input.virtualizationThreshold) {
		return {
			items: input.itemSource.getItems(0, input.itemSource.length),
			startIndex: 0,
			endIndex: input.itemSource.length,
			beforePx: 0,
			afterPx: 0,
			totalPx: 0,
		};
	}

	const totalPx = input.layout.totalPx;
	const viewportHeightPx = Number.isFinite(input.viewportHeightPx)
		? Math.max(MIN_ROW_HEIGHT_PX, input.viewportHeightPx)
		: MIN_ROW_HEIGHT_PX;
	const scrollTopPx = Number.isFinite(input.scrollTopPx) ? Math.max(0, input.scrollTopPx) : 0;
	const overscanPx = Number.isFinite(input.overscanPx) ? Math.max(0, input.overscanPx) : 0;
	const overscanBeforePx =
		input.overscanBeforePx !== undefined && Number.isFinite(input.overscanBeforePx)
			? Math.max(0, input.overscanBeforePx)
			: overscanPx;
	const overscanAfterPx =
		input.overscanAfterPx !== undefined && Number.isFinite(input.overscanAfterPx)
			? Math.max(0, input.overscanAfterPx)
			: overscanPx;
	const windowTopPx = Math.max(0, scrollTopPx - overscanBeforePx);
	const windowBottomPx = Math.min(totalPx, scrollTopPx + viewportHeightPx + overscanAfterPx);
	const startIndex = findStartIndex(input.layout.offsets, input.itemSource.length, windowTopPx);
	const endIndex = findEndIndex(
		input.layout.offsets,
		input.itemSource.length,
		startIndex,
		windowBottomPx
	);
	const beforePx = input.layout.offsets[startIndex] ?? 0;
	const renderedBottomPx = input.layout.offsets[endIndex] ?? beforePx;
	return {
		items: input.itemSource.getItems(startIndex, endIndex),
		startIndex,
		endIndex,
		beforePx,
		afterPx: Math.max(0, totalPx - renderedBottomPx),
		totalPx,
	};
}

export function createMessageScrollerVirtualWindow(input: {
	readonly items: readonly MessageScrollerItem[];
	readonly measuredHeightsByKey: ReadonlyMap<string, number>;
	readonly scrollTopPx: number;
	readonly viewportHeightPx: number;
	readonly overscanPx: number;
	readonly overscanBeforePx?: number;
	readonly overscanAfterPx?: number;
	readonly virtualizationThreshold: number;
}): MessageScrollerVirtualWindow {
	if (input.items.length <= input.virtualizationThreshold) {
		return {
			items: input.items,
			startIndex: 0,
			endIndex: input.items.length,
			beforePx: 0,
			afterPx: 0,
			totalPx: 0,
		};
	}

	const layout = createMessageScrollerVirtualLayout({
		items: input.items,
		measuredHeightsByKey: input.measuredHeightsByKey,
	});
	return createMessageScrollerVirtualWindowFromLayout({
		items: input.items,
		layout,
		scrollTopPx: input.scrollTopPx,
		viewportHeightPx: input.viewportHeightPx,
		overscanPx: input.overscanPx,
		overscanBeforePx: input.overscanBeforePx,
		overscanAfterPx: input.overscanAfterPx,
		virtualizationThreshold: input.virtualizationThreshold,
	});
}

export function resolveMessageScrollerVirtualRowTopFromLayout(input: {
	readonly items: readonly MessageScrollerItem[];
	readonly layout: MessageScrollerVirtualLayout;
	readonly rowId: string;
}): number | null {
	return resolveMessageScrollerVirtualRowTopFromSourceLayout({
		itemSource: createArrayMessageScrollerItemSource(input.items),
		layout: input.layout,
		rowId: input.rowId,
	});
}

export function resolveMessageScrollerVirtualRowTopFromSourceLayout(input: {
	readonly itemSource: MessageScrollerItemSource;
	readonly layout: MessageScrollerVirtualLayout;
	readonly rowId: string;
}): number | null {
	const index = input.itemSource.findIndexByRowId(input.rowId);
	return index === null ? null : input.layout.offsets[index] ?? null;
}

export function resolveMessageScrollerVirtualRowTop(input: {
	readonly items: readonly MessageScrollerItem[];
	readonly measuredHeightsByKey: ReadonlyMap<string, number>;
	readonly rowId: string;
}): number | null {
	const layout = createMessageScrollerVirtualLayout({
		items: input.items,
		measuredHeightsByKey: input.measuredHeightsByKey,
	});
	return resolveMessageScrollerVirtualRowTopFromLayout({
		items: input.items,
		layout,
		rowId: input.rowId,
	});
}

export function resolveMessageScrollerVirtualAnchorFromLayout(input: {
	readonly items: readonly MessageScrollerItem[];
	readonly layout: MessageScrollerVirtualLayout;
	readonly scrollTopPx: number;
}): MessageScrollerVirtualRowTop | null {
	return resolveMessageScrollerVirtualAnchorFromSourceLayout({
		itemSource: createArrayMessageScrollerItemSource(input.items),
		layout: input.layout,
		scrollTopPx: input.scrollTopPx,
	});
}

export function resolveMessageScrollerVirtualAnchorFromSourceLayout(input: {
	readonly itemSource: MessageScrollerItemSource;
	readonly layout: MessageScrollerVirtualLayout;
	readonly scrollTopPx: number;
}): MessageScrollerVirtualRowTop | null {
	const scrollTopPx = Number.isFinite(input.scrollTopPx) ? Math.max(0, input.scrollTopPx) : 0;
	const startIndex = findFirstOffsetAtOrAfter(
		input.layout.offsets,
		input.itemSource.length,
		scrollTopPx
	);
	for (let index = startIndex; index < input.itemSource.length; index += 1) {
		if (input.itemSource.isAnchorEligible(index)) {
			const rowId = input.itemSource.getRowId(index);
			if (rowId === null) {
				continue;
			}
			return {
				rowId,
				topPx: input.layout.offsets[index] ?? 0,
			};
		}
	}
	return null;
}

export function resolveMessageScrollerVirtualAnchor(input: {
	readonly items: readonly MessageScrollerItem[];
	readonly measuredHeightsByKey: ReadonlyMap<string, number>;
	readonly scrollTopPx: number;
}): MessageScrollerVirtualRowTop | null {
	const layout = createMessageScrollerVirtualLayout({
		items: input.items,
		measuredHeightsByKey: input.measuredHeightsByKey,
	});
	return resolveMessageScrollerVirtualAnchorFromLayout({
		items: input.items,
		layout,
		scrollTopPx: input.scrollTopPx,
	});
}
