import { describe, expect, it } from "bun:test";

import type { MessageScrollerItem, MessageScrollerItemSource } from "./message-scroller-types.js";
import {
	createMessageScrollerVirtualLayout,
	createMessageScrollerVirtualLayoutFromSource,
	createMessageScrollerVirtualWindow,
	createMessageScrollerVirtualWindowFromLayout,
	resolveMessageScrollerVirtualAnchor,
	resolveMessageScrollerVirtualAnchorFromLayout,
	resolveMessageScrollerVirtualRowTop,
} from "./message-scroller-virtual-layout.js";

function item(index: number, estimatePx = 100): MessageScrollerItem {
	return {
		key: `row-${index}:v1`,
		rowId: `row-${index}`,
		estimatePx,
		isActiveTail: false,
		anchorEligible: true,
	};
}

function items(count: number): readonly MessageScrollerItem[] {
	const rows: MessageScrollerItem[] = [];
	for (let index = 0; index < count; index += 1) {
		rows.push(item(index));
	}
	return rows;
}

function itemSource(count: number): {
	readonly source: MessageScrollerItemSource;
	keyReadCount(): number;
} {
	let keyReadCount = 0;
	return {
		source: {
			length: count,
			getItem(index: number): MessageScrollerItem | undefined {
				return index < 0 || index >= count ? undefined : item(index);
			},
			getItems(startIndex: number, endIndex: number): readonly MessageScrollerItem[] {
				const rows: MessageScrollerItem[] = [];
				for (let index = startIndex; index < endIndex; index += 1) {
					rows.push(item(index));
				}
				return rows;
			},
			getKey(index: number): string | null {
				keyReadCount += 1;
				return index < 0 || index >= count ? null : `row-${index}:v1`;
			},
			getRowId(index: number): string | null {
				return index < 0 || index >= count ? null : `row-${index}`;
			},
			getEstimatePx(): number {
				return 100;
			},
			isActiveTail(): boolean {
				return false;
			},
			isAnchorEligible(): boolean {
				return true;
			},
			findIndexByRowId(rowId: string): number | null {
				const index = Number(rowId.replace("row-", ""));
				return Number.isInteger(index) && index >= 0 && index < count ? index : null;
			},
		},
		keyReadCount: () => keyReadCount,
	};
}

describe("message scroller virtual layout", () => {
	it("keeps small transcripts unvirtualized", () => {
		const rows = items(3);
		const window = createMessageScrollerVirtualWindow({
			items: rows,
			measuredHeightsByKey: new Map(),
			scrollTopPx: 0,
			viewportHeightPx: 600,
			overscanPx: 200,
			virtualizationThreshold: 200,
		});

		expect(window.items).toBe(rows);
		expect(window.beforePx).toBe(0);
		expect(window.afterPx).toBe(0);
	});

	it("mounts only the rows near the viewport for large transcripts", () => {
		const rows = items(1_000);
		const window = createMessageScrollerVirtualWindow({
			items: rows,
			measuredHeightsByKey: new Map(),
			scrollTopPx: 50_000,
			viewportHeightPx: 800,
			overscanPx: 2_400,
			virtualizationThreshold: 200,
		});

		expect(window.startIndex).toBeGreaterThan(450);
		expect(window.endIndex).toBeLessThan(540);
		expect(window.items.length).toBeLessThan(90);
		expect(window.beforePx).toBeGreaterThan(45_000);
		expect(window.afterPx).toBeGreaterThan(45_000);
	});

	it("supports separate before and after overscan windows", () => {
		const rows = items(1_000);
		const window = createMessageScrollerVirtualWindow({
			items: rows,
			measuredHeightsByKey: new Map(),
			scrollTopPx: 50_000,
			viewportHeightPx: 800,
			overscanPx: 2_400,
			overscanBeforePx: 200,
			overscanAfterPx: 1_500,
			virtualizationThreshold: 200,
		});

		expect(window.startIndex).toBe(497);
		expect(window.endIndex).toBe(524);
		expect(window.items.length).toBe(27);
		expect(window.beforePx).toBe(49_700);
	});

	it("reuses prebuilt row offsets when creating a virtual window", () => {
		const rows = items(1_000);
		const measuredHeightsByKey = new Map<string, number>();
		measuredHeightsByKey.set("row-10:v1", 250);
		const layout = createMessageScrollerVirtualLayout({
			items: rows,
			measuredHeightsByKey,
		});
		const window = createMessageScrollerVirtualWindowFromLayout({
			items: rows,
			layout,
			scrollTopPx: 50_000,
			viewportHeightPx: 800,
			overscanPx: 2_400,
			virtualizationThreshold: 200,
		});

		expect(layout.totalPx).toBe(100_150);
		expect(layout.offsets[11]).toBe(1_250);
		expect(window.items.length).toBeLessThan(90);
		expect(window.beforePx).toBe(layout.offsets[window.startIndex]);
	});

	it("uses indexed measured heights without resolving every row key", () => {
		const measuredHeightsByIndex = new Map([
			[
				10,
				{
					itemKey: "row-10:v1",
					heightPx: 250,
				},
			],
		]);
		const counted = itemSource(1_000);
		const layout = createMessageScrollerVirtualLayoutFromSource({
			itemSource: counted.source,
			measuredHeightsByKey: new Map(),
			measuredHeightsByIndex,
			useMeasuredHeightsByKey: false,
		});

		expect(layout.totalPx).toBe(100_150);
		expect(layout.offsets[11]).toBe(1_250);
		expect(counted.keyReadCount()).toBe(1);
	});

	it("uses measured row heights when resolving row tops", () => {
		const rows = items(5);
		const measuredHeightsByKey = new Map<string, number>();
		measuredHeightsByKey.set("row-1:v1", 250);

		expect(
			resolveMessageScrollerVirtualRowTop({
				items: rows,
				measuredHeightsByKey,
				rowId: "row-3",
			})
		).toBe(450);
	});

	it("resolves the first anchor at or below the current scroll top", () => {
		const rows = items(5);

		expect(
			resolveMessageScrollerVirtualAnchor({
				items: rows,
				measuredHeightsByKey: new Map(),
				scrollTopPx: 220,
			})
		).toEqual({
			rowId: "row-3",
			topPx: 300,
		});
	});

	it("resolves anchors from a prebuilt virtual layout", () => {
		const rows: MessageScrollerItem[] = [
			item(0),
			{
				key: "row-1:v1",
				rowId: "row-1",
				estimatePx: 100,
				isActiveTail: false,
				anchorEligible: false,
			},
			item(2),
		];
		const layout = createMessageScrollerVirtualLayout({
			items: rows,
			measuredHeightsByKey: new Map(),
		});

		expect(
			resolveMessageScrollerVirtualAnchorFromLayout({
				items: rows,
				layout,
				scrollTopPx: 100,
			})
		).toEqual({
			rowId: "row-2",
			topPx: 200,
		});
	});
});
