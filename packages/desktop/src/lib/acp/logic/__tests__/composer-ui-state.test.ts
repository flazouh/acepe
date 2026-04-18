import { describe, expect, it } from "vitest";

import { resolveComposerEnterKeyIntent } from "../composer-ui-state.js";

describe("resolveComposerEnterKeyIntent", () => {
	it("returns none when composer is dispatching", () => {
		expect(
			resolveComposerEnterKeyIntent(
				{
					hasDraftInput: true,
					isAgentBusy: false,
					hasBlockingComposerConfig: false,
					isComposerDispatching: true,
					isSubmitDisabled: false,
				},
				{ shiftKey: false, metaKey: false, ctrlKey: false }
			)
		).toBe("none");
	});

	it("returns send when interactive with draft and no modifiers", () => {
		expect(
			resolveComposerEnterKeyIntent(
				{
					hasDraftInput: true,
					isAgentBusy: false,
					hasBlockingComposerConfig: false,
					isComposerDispatching: false,
					isSubmitDisabled: false,
				},
				{ shiftKey: false, metaKey: false, ctrlKey: false }
			)
		).toBe("send");
	});
});
