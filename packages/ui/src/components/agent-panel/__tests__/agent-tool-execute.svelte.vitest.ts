import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentToolExecute from "../agent-tool-execute.svelte";

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

describe("AgentToolExecute", () => {
	it("renders execute commands as one scrollable code wrapper inside the tool card", () => {
		const view = render(AgentToolExecute, {
			props: {
				command: "go test ./... && bun run check",
				stdout: "ok package",
				status: "done",
				exitCode: 0,
			},
		});

		expect(view.getByTestId("agent-tool-execute-card")).toBeTruthy();
		expect(view.container.querySelector(".rounded-sm.border.border-border")).toBeTruthy();
		const commandBlocks = view.container.querySelectorAll(".execute-blocks pre");
		expect(commandBlocks).toHaveLength(1);
		expect(commandBlocks[0]?.textContent).toContain("go test ./...");
		expect(commandBlocks[0]?.textContent).toContain("bun run check");
		expect(view.container.querySelector(".execute-output-area")?.className).toContain(
			"execute-output-collapsed"
		);
	});
});
