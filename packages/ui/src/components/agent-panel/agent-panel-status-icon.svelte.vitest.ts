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
	it("renders the success check-circle when the session is connected", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "connected",
			connectedLabel: "Thread is connected",
		});

		const icon = view.container.querySelector(".text-success");
		expect(icon).not.toBeNull();
		expect(icon?.querySelector("svg, [data-icon]")).not.toBeNull();
	});

	it("renders the muted check-circle for an idle session", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "idle",
			connectedLabel: "Thread is detached",
		});

		expect(view.container.querySelector(".text-muted-foreground")).not.toBeNull();
		expect(view.container.querySelector(".text-success")).toBeNull();
	});

	it("keeps the success check-circle while the turn is running (pre-migration design)", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "running",
			connectedLabel: "Thread is connected",
		});

		expect(view.container.querySelector(".text-success")).not.toBeNull();
	});

	it("renders nothing while warming (not yet connected, not retrying)", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "warming",
		});

		expect(view.container.textContent).toBe("");
		expect(view.container.querySelector(".text-success")).toBeNull();
	});

	it("still shows the error affordance instead of the connected check", () => {
		const view = render(AgentPanelStatusIcon, {
			status: "error",
			errorLabel: "Thread error - click to retry",
		});

		expect(
			view.container.querySelector('[aria-label="Thread error - click to retry"]'),
		).not.toBeNull();
		expect(view.container.querySelector(".text-success")).toBeNull();
	});
});
