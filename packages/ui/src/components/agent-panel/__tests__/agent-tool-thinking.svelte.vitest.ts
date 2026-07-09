import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentToolThinkingExpandedFixture from "./fixtures/agent-tool-thinking-expanded-fixture.svelte";
import AgentThinkingSceneEntry from "../agent-thinking-scene-entry.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

describe("AgentToolThinking", () => {
	it("renders expanded thinking with a quiet line and label-sized copy", () => {
		const view = render(AgentToolThinkingExpandedFixture);

		expect(view.container.querySelector(".acepe-thinking-dotmatrix")).toBeNull();
		expect(view.getByTestId("thinking-block-line")).toBeTruthy();
		expect(view.getByTestId("thinking-block-content").className).toContain("text-xs");
		expect(view.getByTestId("thinking-copy").textContent).toBe("Checking the next move.");
	});

	it("keeps live planning labels on shimmer text without a loading indicator", () => {
		const view = render(AgentThinkingSceneEntry, {
			props: {
				durationMs: 1200,
				startedAtMs: null,
				label: "Planning next moves...",
			},
		});

		expect(view.container.querySelector(".acepe-dotm-root")).toBeNull();
		expect(view.container.querySelector("[data-testid='thinking-header-line']")).toBeNull();
		expect(view.getByText("Planning next moves...")).toBeTruthy();
	});

	it("shows the agent icon beside a connecting label", () => {
		const view = render(AgentThinkingSceneEntry, {
			props: {
				durationMs: null,
				startedAtMs: null,
				label: "Connecting to Codex Agent",
				agentIconSrc: "/svgs/agents/codex/codex-icon.svg",
			},
		});

		expect(view.getByText("Connecting to Codex Agent")).toBeTruthy();
		expect(view.container.querySelector('img[src="/svgs/agents/codex/codex-icon.svg"]')).toBeTruthy();
	});
});
