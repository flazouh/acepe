import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";

import AgentUserMessage from "../agent-user-message.svelte";

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

describe("AgentUserMessage", () => {
	it("renders local commands in tool card shells outside the user bubble", () => {
		const { container } = render(AgentUserMessage, {
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
		expect(container.querySelector(".rounded-lg.bg-input\\/30.border")).toBeNull();
	});

	it("keeps plain text in the user message shell", () => {
		const { container } = render(AgentUserMessage, {
			props: {
				text: "hello",
				chunks: [{ kind: "text", text: "hello" }],
			},
		});

		expect(container.textContent).toContain("hello");
		expect(container.querySelector(".agent-tool-card")).toBeNull();
	});
});
