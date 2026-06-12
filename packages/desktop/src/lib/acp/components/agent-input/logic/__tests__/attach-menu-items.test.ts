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
	it("shows the chip only when more than one mode exists", () => {
		expect(shouldShowActiveModeChip([{ id: "agent", name: "Agent" }])).toBe(false);
		expect(
			shouldShowActiveModeChip([
				{ id: "plan", name: "Plan" },
				{ id: "agent", name: "Agent" },
			])
		).toBe(true);
	});
});

describe("resolveComposerPlaceholder", () => {
	it("uses the active mode description when available", () => {
		expect(
			resolveComposerPlaceholder({
				modes: [{ id: "multitask", name: "Multitask", description: "Coordinate parallel tasks…" }],
				currentModeId: "multitask",
			})
		).toBe("Coordinate parallel tasks…");
	});

	it("falls back to the default placeholder when mode has no description", () => {
		expect(
			resolveComposerPlaceholder({
				modes: [{ id: "agent", name: "Agent" }],
				currentModeId: "agent",
			})
		).toBe("Plan, @ for context, / for commands");
	});
});
