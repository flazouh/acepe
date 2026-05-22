import { describe, expect, test } from "bun:test";
import {
	FALLBACK_MODE_OPTION,
	getModeDropdownOptions,
	getModeIconColor,
	getSelectedModeOption,
	shouldEmitModeChange,
	type AgentInputMode,
} from "./agent-input-mode-selector-state.js";

const modes: readonly AgentInputMode[] = [
	{
		id: "agent",
		label: "Agent",
		description: "Use agent mode",
		iconKind: "agent",
	},
	{
		id: "plan",
		name: "Plan",
		description: null,
		iconKind: "plan",
	},
	{
		id: "raw-id",
	},
];

describe("agent input mode selector state", () => {
	test("maps modes into dropdown options with label fallbacks", () => {
		expect(getModeDropdownOptions(modes)).toEqual([
			{
				id: "agent",
				label: "Agent",
				description: "Use agent mode",
				iconKind: "agent",
			},
			{
				id: "plan",
				label: "Plan",
				description: null,
				iconKind: "plan",
			},
			{
				id: "raw-id",
				label: "raw-id",
				description: undefined,
				iconKind: "unknown",
			},
		]);
	});

	test("selects current mode, then first option, then fallback", () => {
		const options = getModeDropdownOptions(modes);

		expect(getSelectedModeOption({ modeOptions: options, currentModeId: "plan" })).toBe(
			options[1]
		);
		expect(
			getSelectedModeOption({ modeOptions: options, currentModeId: "missing" })
		).toBe(options[0]);
		expect(
			getSelectedModeOption({ modeOptions: [], currentModeId: "missing" })
		).toEqual(FALLBACK_MODE_OPTION);
	});

	test("maps mode icon colors", () => {
		expect(getModeIconColor("agent")).toBe("var(--build-icon)");
		expect(getModeIconColor("plan")).toBe("var(--plan-icon)");
		expect(getModeIconColor("autonomous")).toBe("var(--chart-5)");
		expect(getModeIconColor("bypass")).toBe("#9858FF");
		expect(getModeIconColor("ask")).toBe("var(--chart-1)");
		expect(getModeIconColor("edit")).toBe("var(--chart-2)");
		expect(getModeIconColor("review")).toBe("var(--chart-3)");
		expect(getModeIconColor("unknown")).toBe("var(--muted-foreground)");
	});

	test("emits mode changes only for new modes", () => {
		expect(
			shouldEmitModeChange({ nextModeId: "plan", currentModeId: "agent" })
		).toBe(true);
		expect(
			shouldEmitModeChange({ nextModeId: "plan", currentModeId: "plan" })
		).toBe(false);
		expect(shouldEmitModeChange({ nextModeId: "plan", currentModeId: null })).toBe(
			true
		);
	});
});
