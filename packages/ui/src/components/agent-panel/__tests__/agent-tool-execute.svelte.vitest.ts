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

	it("renders Shiki command and output html from highlight callbacks", () => {
		const view = render(AgentToolExecute, {
			props: {
				command: "echo hi",
				stdout: "ok",
				stderr: "warn",
				status: "done",
				exitCode: 0,
				highlightCommand: (code: string) =>
					`<span style="color: var(--shiki-light)">${code}</span>`,
				highlightOutput: (code: string) =>
					`<span class="line" style="color: var(--shiki-dark)">${code}</span>`,
			},
		});

		const commandBlock = view.container.querySelector(".execute-block.shiki");
		expect(commandBlock?.innerHTML).toContain("--shiki-light");
		expect(commandBlock?.textContent).toContain("echo hi");

		const stdoutShiki = view.container.querySelector(".execute-output-shiki");
		expect(stdoutShiki?.innerHTML).toContain("--shiki-dark");
		expect(stdoutShiki?.textContent).toBe("ok");
	});

	it("keeps plain fallback when highlight callbacks return null (cap / not ready)", () => {
		const view = render(AgentToolExecute, {
			props: {
				command: "echo hi",
				stdout: "plain-out",
				status: "done",
				exitCode: 0,
				highlightCommand: () => null,
				highlightOutput: () => null,
			},
		});

		expect(view.container.querySelector(".execute-block.shiki")).toBeNull();
		expect(view.container.querySelector(".execute-output-shiki")).toBeNull();
		expect(view.container.querySelector(".execute-output")?.textContent).toBe("plain-out");
	});
});
