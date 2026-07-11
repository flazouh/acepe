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
		expect(view.getByTestId("agent-tool-execute-card").className).not.toContain("border");
		expect(view.getByTestId("tool-kind-icon-execute")).toBeTruthy();
		const commandBlocks = view.container.querySelectorAll(".execute-blocks > .execute-block");
		expect(commandBlocks.length).toBeGreaterThan(0);
		const commandText = Array.from(commandBlocks, (block) => block.textContent).join("\n");
		expect(commandText).toContain("go test ./...");
		expect(commandText).toContain("bun run check");
		expect(view.container.querySelector(".execute-output-area")?.className).toContain(
			"execute-output-collapsed"
		);
	});
});
