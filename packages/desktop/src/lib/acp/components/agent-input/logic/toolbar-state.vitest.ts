import { describe, expect, it } from "vitest";

import { CanonicalModeId } from "../../../types/canonical-mode-id.js";

import {
	resolveInitialModelIdForNewSession,
	resolvePendingToolbarSelections,
	resolveToolbarModeId,
	resolveToolbarModelId,
} from "./toolbar-state.js";
import { resolveResolvableToolbarModelId } from "./resolve-resolvable-toolbar-model-id.js";

describe("toolbar-state", () => {
	const visibleModes = [
		{ id: CanonicalModeId.BUILD, name: "Build" },
		{ id: CanonicalModeId.PLAN, name: "Plan" },
	];

	const availableModels = [
		{ id: "claude-sonnet", name: "Claude Sonnet" },
		{ id: "claude-opus", name: "Claude Opus" },
	];

	describe("resolveToolbarModeId", () => {
		it("prefers live current mode", () => {
			expect(
				resolveToolbarModeId({
					liveCurrentModeId: CanonicalModeId.PLAN,
					provisionalModeId: CanonicalModeId.BUILD,
					visibleModes,
				})
			).toBe(CanonicalModeId.PLAN);
		});

		it("uses provisional mode when live mode is missing", () => {
			expect(
				resolveToolbarModeId({
					liveCurrentModeId: null,
					provisionalModeId: CanonicalModeId.PLAN,
					visibleModes,
				})
			).toBe(CanonicalModeId.PLAN);
		});

		it("falls back to build when visible", () => {
			expect(
				resolveToolbarModeId({
					liveCurrentModeId: null,
					provisionalModeId: null,
					visibleModes,
				})
			).toBe(CanonicalModeId.BUILD);
		});
	});

	describe("resolveToolbarModelId", () => {
		it("shows a valid provisional model selection while live capabilities catch up", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: "claude-opus",
					provisionalModelId: "claude-sonnet",
					defaultModelId: null,
					availableModels,
					allowsImplicitModelSelection: true,
				})
			).toBe("claude-sonnet");
		});

		it("uses valid provisional model when live is missing", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: "claude-opus",
					defaultModelId: null,
					availableModels,
					allowsImplicitModelSelection: true,
				})
			).toBe("claude-opus");
		});

		it("falls back to first available model when live and provisional are missing", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: null,
					defaultModelId: null,
					availableModels,
					allowsImplicitModelSelection: true,
				})
			).toBe("claude-sonnet");
		});

		it("falls back to first available model when provisional is invalid", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: "invalid-model",
					defaultModelId: null,
					availableModels,
					allowsImplicitModelSelection: true,
				})
			).toBe("claude-sonnet");
		});

		it("preserves no selection when the provider requires an explicit choice", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: null,
					defaultModelId: null,
					availableModels,
					allowsImplicitModelSelection: false,
				})
			).toBeNull();
		});

		it("uses a valid default model before falling back to the first available model", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: null,
					defaultModelId: "claude-opus",
					availableModels,
					allowsImplicitModelSelection: true,
				})
			).toBe("claude-opus");
		});

		it("ignores a stale default model", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: null,
					defaultModelId: "missing",
					availableModels,
					allowsImplicitModelSelection: true,
				})
			).toBe("claude-sonnet");
		});
	});

	describe("resolveInitialModelIdForNewSession", () => {
		it("uses the displayed model for a new session", () => {
			expect(
				resolveInitialModelIdForNewSession({
					sessionId: null,
					displayedModelId: "claude-opus",
				})
			).toBe("claude-opus");
		});

		it("captures an explicit sonnet pick instead of the default opus displayed id", () => {
			expect(
				resolveInitialModelIdForNewSession({
					sessionId: null,
					displayedModelId: "claude-sonnet-4-6",
				})
			).toBe("claude-sonnet-4-6");
		});

		it("does not send an initial model for an existing session", () => {
			expect(
				resolveInitialModelIdForNewSession({
					sessionId: "session-1",
					displayedModelId: "claude-opus",
				})
			).toBeNull();
		});
	});

	describe("resolveResolvableToolbarModelId", () => {
		it("prefers the explicit provisional sonnet pick over the default opus toolbar id", () => {
			expect(
				resolveResolvableToolbarModelId({
					provisionalModelId: "claude-sonnet-4-6",
					resolvedToolbarModelId: "claude-opus-4-6",
				})
			).toBe("claude-sonnet-4-6");
		});
	});

	describe("resolvePendingToolbarSelections", () => {
		it("returns pending mode and model applications for valid provisional selections", () => {
			expect(
				resolvePendingToolbarSelections({
					provisionalModeId: CanonicalModeId.PLAN,
					provisionalModelId: "claude-opus",
					liveCurrentModeId: CanonicalModeId.BUILD,
					liveCurrentModelId: "claude-sonnet",
					availableModes: visibleModes,
					availableModels,
				})
			).toEqual({
				modeIdToApply: CanonicalModeId.PLAN,
				modelIdToApply: "claude-opus",
				nextProvisionalModeId: CanonicalModeId.PLAN,
				nextProvisionalModelId: "claude-opus",
			});
		});

		it("clears invalid provisional selections when live capabilities arrive", () => {
			expect(
				resolvePendingToolbarSelections({
					provisionalModeId: "invalid-mode",
					provisionalModelId: "invalid-model",
					liveCurrentModeId: CanonicalModeId.BUILD,
					liveCurrentModelId: "claude-sonnet",
					availableModes: visibleModes,
					availableModels,
				})
			).toEqual({
				modeIdToApply: null,
				modelIdToApply: null,
				nextProvisionalModeId: null,
				nextProvisionalModelId: null,
			});
		});
	});
});
