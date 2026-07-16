import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentUserMessage from "../agent-user-message.svelte";

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

const loginCommandChunk = {
	kind: "localCommand" as const,
	command: "/login",
	message: "login",
	args: "",
	stdout: "Login successful",
	chip: {
		command: "/login",
		message: "login",
		stdout: "Login successful",
		cleanStdout: "Login successful",
		displayModelName: "",
		displayModelDescription: null,
		isModelCommand: false,
	},
};

afterEach(() => {
	cleanup();
});

describe("AgentUserMessage", () => {
	it("renders local commands in tool card shells outside the user bubble", () => {
		const { container, queryByTestId } = render(AgentUserMessage, {
			props: {
				text: "/login",
				chunks: [loginCommandChunk],
			},
		});

		expect(container.textContent).toContain("/login");
		expect(container.textContent).toContain("Login successful");
		expect(container.textContent).not.toContain("<command-name>");
		expect(container.querySelector(".agent-tool-card")).toBeTruthy();
		expect(container.querySelector("[data-testid='command-output-card']")).toBeTruthy();
		expect(queryByTestId("agent-user-message-card")).toBeNull();
	});

	it("keeps plain text in a borderless tool-like shell with header timestamp and copy", () => {
		const { getByTestId, container } = render(AgentUserMessage, {
			props: {
				text: "hello",
				chunks: [{ kind: "text", text: "hello" }],
				timestampMs: Date.UTC(2026, 6, 16, 13, 1, 0),
			},
		});

		const surface = getByTestId("agent-user-message-card");
		expect(surface.className).toContain("rounded-lg");
		expect(surface.className).toContain("overflow-hidden");
		expect(surface.className).toContain("bg-input/50");
		expect(surface.className).not.toContain("border");
		expect(surface.textContent).toContain("hello");
		expect(surface.textContent).not.toContain("You");
		expect(getByTestId("agent-user-message-timestamp")).toBeTruthy();
		expect(container.querySelector("[data-testid='agent-copy-button-linear-copy-icon']")).toBeTruthy();
		expect(container.querySelector(".agent-tool-card")).toBeNull();
	});
});
