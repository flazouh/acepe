import { describe, expect, it } from "vitest";

import { filterAttachMenuItems } from "../agent-input-attach-menu-state.js";

describe("filterAttachMenuItems", () => {
	it("filters modes and commands by search query", () => {
		const result = filterAttachMenuItems({
			query: "plan",
			modes: [
				{
					id: "plan",
					label: "Plan",
					description: "Read-only planning",
					iconKind: "plan",
					selected: true,
				},
				{
					id: "agent",
					label: "Agent",
					description: "Execute changes",
					iconKind: "agent",
					selected: false,
				},
			],
			commands: [
				{
					id: "ce-plan",
					label: "ce-plan",
					description: "Create a plan",
					tokenType: "skill",
				},
			],
		});

		expect(result.modes).toHaveLength(1);
		expect(result.modes[0]?.id).toBe("plan");
		expect(result.commands).toHaveLength(1);
	});
});
