import { describe, expect, it } from "bun:test";

import {
	resolvePlanningPlaceholderPresentation,
	resolveRunningTurnOutputTokens,
} from "../planning-placeholder-presentation.js";

describe("resolvePlanningPlaceholderPresentation", () => {
	it("uses the selected agent name and icon for the local connecting row", () => {
		const result = resolvePlanningPlaceholderPresentation({
			agentName: "Codex Agent",
			agentIconSrc: "data:image/svg+xml,hugeicons",
			showWorkingSpark: false,
		});

		expect(result).toEqual({
			label: "Connecting to Codex Agent",
			agentIconSrc: "data:image/svg+xml,hugeicons",
			showWorkingSpark: false,
			startedAtMs: null,
			workingLineVerbs: null,
			workingLineTokens: null,
		});
	});

	it("keeps Claude's working spark while still using connecting copy", () => {
		const result = resolvePlanningPlaceholderPresentation({
			agentName: "Claude Code",
			agentIconSrc: "data:image/svg+xml,hugeicons",
			showWorkingSpark: true,
		});

		expect(result).toEqual({
			label: "Connecting to Claude Code",
			agentIconSrc: "data:image/svg+xml,hugeicons",
			showWorkingSpark: true,
			startedAtMs: null,
			workingLineVerbs: null,
			workingLineTokens: null,
		});
	});

	it("falls back to a generic agent label when the name is not known yet", () => {
		const result = resolvePlanningPlaceholderPresentation({
			agentName: "  ",
			agentIconSrc: null,
			showWorkingSpark: false,
		});

		expect(result).toEqual({
			label: "Connecting to agent",
			agentIconSrc: null,
			showWorkingSpark: false,
			startedAtMs: null,
			workingLineVerbs: null,
			workingLineTokens: null,
		});
	});

	it("carries the working-line inputs through when a turn is running", () => {
		const verbs = ["Puzzling", "Pondering"];
		const result = resolvePlanningPlaceholderPresentation({
			agentName: "Claude Code",
			agentIconSrc: null,
			showWorkingSpark: true,
			startedAtMs: 1_000,
			workingLineVerbs: verbs,
			workingLineTokens: 48,
		});

		expect(result.startedAtMs).toBe(1_000);
		expect(result.workingLineVerbs).toBe(verbs);
		expect(result.workingLineTokens).toBe(48);
	});
});

describe("resolveRunningTurnOutputTokens", () => {
	it("returns null when there is no usage telemetry yet", () => {
		expect(
			resolveRunningTurnOutputTokens({ usageTelemetry: null, turnStartedAtMs: 1_000 })
		).toBeNull();
	});

	it("returns null when no turn is running", () => {
		expect(
			resolveRunningTurnOutputTokens({
				usageTelemetry: { latestTokensOutput: 48, updatedAt: 2_000 },
				turnStartedAtMs: null,
			})
		).toBeNull();
	});

	it("returns the reading when it arrived after the turn started", () => {
		expect(
			resolveRunningTurnOutputTokens({
				usageTelemetry: { latestTokensOutput: 48, updatedAt: 2_000 },
				turnStartedAtMs: 1_000,
			})
		).toBe(48);
	});

	it("returns null for a stale reading from before the turn started (never shows a prior turn's count)", () => {
		expect(
			resolveRunningTurnOutputTokens({
				usageTelemetry: { latestTokensOutput: 999, updatedAt: 500 },
				turnStartedAtMs: 1_000,
			})
		).toBeNull();
	});
});
