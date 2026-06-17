import { describe, expect, it } from "vitest";

import { resolveAgentPanelHeaderSequenceId } from "../agent-panel-header-sequence-id.js";

describe("resolveAgentPanelHeaderSequenceId", () => {
	it("prefers session metadata when sequence id is already materialized", () => {
		expect(
			resolveAgentPanelHeaderSequenceId({
				sessionMetadataSequenceId: 4,
				pendingCreationSequenceId: 7,
				hasPendingCreationSession: true,
			})
		).toBe(4);
	});

	it("projects pending creation sequence id while metadata is absent during first-send connecting", () => {
		expect(
			resolveAgentPanelHeaderSequenceId({
				sessionMetadataSequenceId: undefined,
				pendingCreationSequenceId: 7,
				hasPendingCreationSession: true,
			})
		).toBe(7);
	});

	it("does not project pending sequence id after pending creation completes", () => {
		expect(
			resolveAgentPanelHeaderSequenceId({
				sessionMetadataSequenceId: undefined,
				pendingCreationSequenceId: 7,
				hasPendingCreationSession: false,
			})
		).toBeNull();
	});
});
