import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import AgentPanelStatusIcon from "./agent-panel-status-icon.svelte";

afterEach(() => {
	cleanup();
});

describe("AgentPanelStatusIcon connected affordance", () => {
	it("renders a subtle success dot with the connected label when the session is connected", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "connected",
			connectedLabel: "Thread is connected",
		});

		const dot = view.container.querySelector(
			'[aria-label="Thread is connected"]',
		);
		expect(dot).not.toBeNull();
		expect(dot?.className).toContain("bg-success/60");
	});

	it("renders the connected affordance for idle and done sessions", () => {
		const idleView = render(AgentPanelStatusIcon, {
			status: "idle",
			connectedLabel: "Thread is detached",
		});
		expect(
			idleView.container.querySelector('[aria-label="Thread is detached"]'),
		).not.toBeNull();
		cleanup();

		const doneView = render(AgentPanelStatusIcon, {
			status: "done",
			connectedLabel: "Thread is complete",
		});
		expect(
			doneView.container.querySelector('[aria-label="Thread is complete"]'),
		).not.toBeNull();
	});

	it("renders a pulsing dot for a running session", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "running",
			warmingLabel: "Thread is running",
		});

		const dot = view.container.querySelector(
			'[aria-label="Thread is running"]',
		);
		expect(dot).not.toBeNull();
		expect(view.container.querySelector(".animate-ping")).not.toBeNull();
	});

	it("renders nothing while warming (not yet connected, not retrying)", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "warming",
		});

		expect(view.container.textContent).toBe("");
		expect(view.container.querySelector(".bg-success\\/60")).toBeNull();
	});

	it("still shows the error affordance instead of the connected dot", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "error",
			errorLabel: "Thread error - click to retry",
		});

		expect(
			view.container.querySelector(
				'[aria-label="Thread error - click to retry"]',
			),
		).not.toBeNull();
		expect(view.container.querySelector(".bg-success\\/60")).toBeNull();
	});
});
