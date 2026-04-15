import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPanelConversationEntry, AgentPanelSceneEntry } from "@acepe/ui";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../../../node_modules/svelte/src/index-client.js")
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
