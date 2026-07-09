import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelRecoveryCard from "./agent-panel-recovery-card.svelte";

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

afterEach(() => cleanup());

describe("AgentPanelRecoveryCard", () => {
	it("shows recovery copy and invokes the primary action", async () => {
		const onAction = vi.fn();
		const view = render(AgentPanelRecoveryCard, {
			props: {
				title: "Session archived",
				actionLabel: "Unarchive",
				actionIconName: "undo",
				onAction,
			},
		});

		expect(view.getByText("Session archived")).toBeTruthy();

		const action = view.getByRole("button", { name: "Unarchive" });
		expect(action.getAttribute("data-variant")).toBe("default");
		expect(action.querySelector("svg")).toBeTruthy();

		await fireEvent.click(action);
		expect(onAction).toHaveBeenCalledTimes(1);
	});
});
