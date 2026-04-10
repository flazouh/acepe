import { describe, expect, it } from "bun:test";

import { type HotPathDiagnosticSnapshot, HotPathDiagnostics } from "../hot-path-diagnostics.js";

describe("HotPathDiagnostics", () => {
	it("aggregates repeated events and flushes the completed window before a new one starts", () => {
		let now = 0;
		const snapshots: HotPathDiagnosticSnapshot[] = [];
		const diagnostics = new HotPathDiagnostics({
			intervalMs: 1000,
			now: () => now,
			emit: (snapshot) => {
				snapshots.push(snapshot);
			},
			isEnabled: () => true,
		});

		diagnostics.record("markdown-renderer", "sync-render");
		diagnostics.record("markdown-renderer", "sync-render", 4);

		now = 1001;
		diagnostics.record("text-reveal", "animation-frame");

		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toEqual({
			windowMs: 1001,
			samples: [
				{
					scope: "markdown-renderer",
					event: "sync-render",
					count: 2,
					totalValue: 4,
					maxValue: 4,
					lastValue: 4,
				},
			],
		});
	});

	it("does nothing while diagnostics are disabled", () => {
		let now = 0;
		const snapshots: HotPathDiagnosticSnapshot[] = [];
		const diagnostics = new HotPathDiagnostics({
			intervalMs: 1000,
			now: () => now,
			emit: (snapshot) => {
				snapshots.push(snapshot);
			},
			isEnabled: () => false,
		});

		diagnostics.record("markdown-renderer", "sync-render", 9);
		now = 2000;
		diagnostics.flush();

		expect(snapshots).toHaveLength(0);
	});

	it("flushes the current window on demand", () => {
		let now = 250;
		const snapshots: HotPathDiagnosticSnapshot[] = [];
		const diagnostics = new HotPathDiagnostics({
			intervalMs: 1000,
			now: () => now,
			emit: (snapshot) => {
				snapshots.push(snapshot);
			},
			isEnabled: () => true,
		});

		diagnostics.record("auto-scroll", "handle-scroll-frame", 12);
		now = 550;
		diagnostics.flush();

		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toEqual({
			windowMs: 300,
			samples: [
				{
					scope: "auto-scroll",
					event: "handle-scroll-frame",
					count: 1,
					totalValue: 12,
					maxValue: 12,
					lastValue: 12,
				},
			],
		});
	});
});
