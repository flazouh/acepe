import { AgentPanelConversationEntry, AgentPanelLayout, AgentPanelSceneEntry } from "@acepe/ui";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../../../../node_modules/svelte/src/index-client.js")
);

afterEach(() => {
	cleanup();
});

describe("planning placeholder labels", () => {
	it("keeps the shared conversation entry label static even when duration is present", () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "thinking-entry",
				type: "thinking",
				durationMs: 4_000,
			},
		});

		expect(view.getByText("Planning next moves…")).toBeTruthy();
		expect(view.queryByText("Planning next moves for 4s…")).toBeNull();
	});

	it("keeps the scene entry label static even when duration is present", () => {
		const view = render(AgentPanelSceneEntry, {
			entry: {
				id: "thinking-entry",
				type: "thinking",
				durationMs: 4_000,
			},
		});

		expect(view.getByText("Planning next moves…")).toBeTruthy();
		expect(view.queryByText("Planning next moves for 4s…")).toBeNull();
	});
});

describe("skill tool rendering", () => {
	it("renders skill names in the shared conversation fallback renderer", () => {
		const view = render(AgentPanelConversationEntry, {
			entry: {
				id: "skill-entry",
				type: "tool_call",
				kind: "skill",
				title: "Skill",
				status: "done",
				skillName: "frontend-design",
				skillArgs: null,
				skillDescription: null,
			},
		});

		expect(view.getByText("/frontend-design")).toBeTruthy();
		expect(view.queryByText("Skill")).toBeNull();
	});

	it("renders skill names in the scene renderer", () => {
		const view = render(AgentPanelSceneEntry, {
			entry: {
				id: "skill-entry",
				type: "tool_call",
				kind: "skill",
				title: "Skill",
				status: "done",
				skillName: "agent-browser",
				skillArgs: null,
				skillDescription: null,
			},
		});

		expect(view.getByText("/agent-browser")).toBeTruthy();
		expect(view.queryByText("Skill")).toBeNull();
	});

	it("renders skill names in the legacy panel layout renderer", () => {
		const view = render(AgentPanelLayout, {
			entries: [
				{
					id: "skill-entry",
					type: "tool_call",
					kind: "skill",
					title: "Skill",
					status: "done",
					skillName: "frontend-design",
					skillArgs: null,
					skillDescription: null,
				},
			],
		});

		expect(view.getByText("/frontend-design")).toBeTruthy();
		expect(view.queryByText("Skill")).toBeNull();
	});
});
