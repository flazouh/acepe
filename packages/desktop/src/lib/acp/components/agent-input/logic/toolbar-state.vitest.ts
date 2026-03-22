import { describe, expect, it } from "vitest";

import { CanonicalModeId } from "../../../types/canonical-mode-id.js";

import {
	resolvePendingToolbarSelections,
	resolveToolbarModeId,
	resolveToolbarModelId,
} from "./toolbar-state.js";

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
		it("prefers live current model", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: "claude-opus",
					provisionalModelId: "claude-sonnet",
					availableModels,
					preferredDefaultModelId: "claude-sonnet",
				})
			).toBe("claude-opus");
		});

		it("uses valid provisional model before defaults", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: "claude-opus",
					availableModels,
					preferredDefaultModelId: "claude-sonnet",
				})
			).toBe("claude-opus");
		});

		it("uses valid default model when live and provisional are missing", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: null,
					availableModels,
					preferredDefaultModelId: "claude-opus",
				})
			).toBe("claude-opus");
		});

		it("falls back to first available model", () => {
			expect(
				resolveToolbarModelId({
					liveCurrentModelId: null,
					provisionalModelId: "invalid-model",
					availableModels,
					preferredDefaultModelId: "missing-default",
				})
			).toBe("claude-sonnet");
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
