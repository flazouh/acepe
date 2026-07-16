import { describe, expect, it } from "bun:test";

import { resolvePlanningPlaceholderPresentation } from "../planning-placeholder-presentation.js";

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
		});
	});
});
