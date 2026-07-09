import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelTranscriptScrollControls from "./agent-panel-transcript-scroll-controls.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");
	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => cleanup());

describe("AgentPanelTranscriptScrollControls", () => {
	it("marks the bottom control when unread content exists below", () => {
		render(AgentPanelTranscriptScrollControls, {
			props: {
				showScrollToBottom: true,
				hasUnreadBelow: true,
			},
		});

		const button = screen.getByRole("button", { name: "Scroll to new messages" });
		expect(button.getAttribute("data-unread-below")).toBe("true");
	});
});
