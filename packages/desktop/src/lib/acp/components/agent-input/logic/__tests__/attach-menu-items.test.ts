import { describe, expect, it } from "vitest";

import {
	buildAttachMenuCommands,
	buildAttachMenuModes,
	resolveDefaultModeId,
	shouldShowActiveModeChip,
} from "../attach-menu-items.js";
import { resolveComposerPlaceholder } from "../composer-placeholder.js";

describe("buildAttachMenuModes", () => {
	it("maps available modes to attach menu items with selection state", () => {
		const items = buildAttachMenuModes({
			modes: [
				{ id: "plan", name: "Plan", description: "Read-only planning", iconKind: "plan" },
				{ id: "agent", name: "Agent", description: "Execute changes", iconKind: "agent" },
			],
			currentModeId: "agent",
		});

		expect(items).toHaveLength(2);
		expect(items[0]).toEqual({
			id: "plan",
			label: "Plan",
			description: "Read-only planning",
			iconKind: "plan",
			selected: false,
			disabled: false,
		});
		expect(items[1]?.selected).toBe(true);
	});
});

describe("buildAttachMenuCommands", () => {
	it("maps slash commands to attach menu command items", () => {
		const items = buildAttachMenuCommands({
			tokenType: "skill",
			commands: [{ name: "ce-plan", description: "Create a plan" }],
		});

		expect(items).toEqual([
			{
				id: "ce-plan",
				label: "ce-plan",
				description: "Create a plan",
				tokenType: "skill",
			},
		]);
	});
});

describe("resolveDefaultModeId", () => {
	it("returns the first mode when modes exist", () => {
		expect(
			resolveDefaultModeId([
				{ id: "plan", name: "Plan" },
				{ id: "agent", name: "Agent" },
			])
		).toBe("plan");
	});

	it("returns null when no modes exist", () => {
		expect(resolveDefaultModeId([])).toBeNull();
	});
});

describe("shouldShowActiveModeChip", () => {
	const modes = [
		{ id: "agent", name: "Agent" },
		{ id: "plan", name: "Plan" },
	];

	it("hides the chip when only one mode exists", () => {
		expect(shouldShowActiveModeChip([{ id: "agent", name: "Agent" }], "agent")).toBe(false);
	});

	it("hides the chip when the current mode is the default (first) mode", () => {
		expect(shouldShowActiveModeChip(modes, "agent")).toBe(false);
	});

	it("shows the chip when the current mode is a non-default mode", () => {
		expect(shouldShowActiveModeChip(modes, "plan")).toBe(true);
	});

	it("hides the chip when currentModeId is null and default is first mode", () => {
		expect(shouldShowActiveModeChip(modes, null)).toBe(false);
	});
});

describe("resolveComposerPlaceholder", () => {
	it("prompts for a follow-up once a session is active", () => {
		expect(resolveComposerPlaceholder({ hasSession: true })).toBe("Send follow-up");
	});

	it("shows the typing hint when there is no session yet", () => {
		expect(resolveComposerPlaceholder({ hasSession: false })).toBe(
			"Plan, @ for context, / for commands"
		);
	});

	it("honors a custom fallback when there is no session", () => {
		expect(resolveComposerPlaceholder({ hasSession: false, fallback: "Ask anything" })).toBe(
			"Ask anything"
		);
	});
});
