import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelComposer from "./agent-panel-composer.svelte";
import { AGENT_PANEL_ACTION_IDS } from "./types.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");
	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => cleanup());

describe("AgentPanelComposer", () => {
	it("exposes the submit action with the Send message accessible name", () => {
		render(AgentPanelComposer, {
			props: {
				composer: {
					draftText: "hello",
					placeholder: "Ask the agent",
					submitLabel: "Send message",
					actions: [
						{
							id: AGENT_PANEL_ACTION_IDS.composer.submit,
							state: "enabled",
						},
					],
				},
			},
		});

		const button = screen.getByRole("button", { name: "Send message" });
		expect(button.getAttribute("aria-label")).toBe("Send message");
	});
});
