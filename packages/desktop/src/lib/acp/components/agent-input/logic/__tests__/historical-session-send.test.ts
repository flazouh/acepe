import { describe, expect, it } from "vitest";

import { deriveComposerInteractionState } from "../../../../logic/composer-ui-state.js";
import { resolveDefaultSubmitAction } from "../../../../logic/submit-intent.js";

/**
 * Regression: reopened historical sessions stay sendable when disconnected+loaded
 * (lazy connect on first submit) and composer policy does not add a hidden veto.
 */
describe("historical session send policy", () => {
	it("allows default send when runtime permits submit and composer is not blocking or dispatching", () => {
		expect(
			resolveDefaultSubmitAction({
				hasDraftInput: true,
				hasSessionId: true,
				isAgentBusy: false,
				isStreaming: false,
				isSubmitDisabled: false,
				hasBlockingComposerConfig: false,
				isComposerDispatching: false,
			})
		).toBe("send");
	});

	it("derives interactive composer affordances for loaded/disconnected-style submit", () => {
		const interaction = deriveComposerInteractionState({
			hasDraftInput: true,
			hasSessionId: true,
			isAgentBusy: false,
			isStreaming: false,
			isShiftPressed: false,
			isSubmitDisabled: false,
			hasBlockingComposerConfig: false,
			isComposerDispatching: false,
		});
		expect(interaction.defaultSubmitAction).toBe("send");
		expect(interaction.primaryButtonDisabled).toBe(false);
	});
});
