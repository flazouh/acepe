import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelConversationEntry from "../agent-panel-conversation-entry.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

// AC-269: transcript-viewport-row-renderer.svelte (the desktop app's real,
// live row renderer) mounts entries through THIS component, not
// agent-panel-scene/agent-panel-scene-entry.svelte -- a parallel dispatcher
// that looks identical but is unused by the live transcript. Live QA caught
// this the hard way: the working line rendered correctly through the scene
// dispatcher's own tests, but the deployed app kept showing the old static
// "Planning next moves" label with no verb/tokens/interrupt hint, because
// this file's own "thinking" branch never forwarded the four new props.
// Pins that regression down at the component boundary that actually ships.
describe("AgentPanelConversationEntry working line", () => {
	it("forwards the working-line props to AgentThinkingSceneEntry for a thinking entry", () => {
		const view = render(AgentPanelConversationEntry, {
			props: {
				entry: {
					id: "awaiting:planning",
					type: "thinking",
					durationMs: null,
					startedAtMs: 1_000,
					label: null,
					agentIconSrc: null,
					showWorkingSpark: true,
					workingLineVerbs: ["Puzzling", "Pondering"],
					workingLineSeed: 1_000,
					workingLineTokens: 48,
				},
			},
		});

		const spark = view.container.querySelector("[data-claude-working-spark]");
		expect(spark).not.toBeNull();
		// The working line replaces the plain "Planning next moves" fallback
		// with a rotating verb + parenthetical -- asserting the fallback text
		// is ABSENT is what actually catches a dropped prop (an empty/default
		// working line would silently fall back to this exact string).
		expect(view.container.textContent).not.toContain("Planning next moves");
		expect(view.container.textContent).toContain("↑ 48 tokens");
	});
});
