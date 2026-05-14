import { describe, expect, it } from "bun:test";

import {
	type RevealTargetActionParams,
	shouldRestartRevealTargetAction,
} from "../reveal-target-action-params.js";

function createParams(overrides: Partial<RevealTargetActionParams> = {}): RevealTargetActionParams {
	return {
		entryIndex: overrides.entryIndex ?? 1,
		entryKey: overrides.entryKey ?? "assistant-1",
		observeRevealResize: overrides.observeRevealResize ?? true,
		onRevealResize: overrides.onRevealResize ?? (() => undefined),
	};
}

describe("shouldRestartRevealTargetAction", () => {
	it("does not restart when only the wrapper object or reveal callback identity changes", () => {
		const currentParams = createParams({
			onRevealResize: () => undefined,
		});
		const nextParams = createParams({
			onRevealResize: () => undefined,
		});

		expect(shouldRestartRevealTargetAction(currentParams, nextParams)).toBe(false);
	});

	it("restarts when the observed key or resize mode changes", () => {
		const currentParams = createParams();

		expect(
			shouldRestartRevealTargetAction(currentParams, createParams({ entryKey: "assistant-2" }))
		).toBe(true);
		expect(
			shouldRestartRevealTargetAction(currentParams, createParams({ observeRevealResize: false }))
		).toBe(true);
	});
});
