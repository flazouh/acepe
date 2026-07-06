import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelConversationEntry from "../agent-panel-conversation-entry.svelte";

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

describe("AgentPanelConversationEntry question card", () => {
	it("routes user file chip clicks to the host", async () => {
		const onUserFileSelect = vi.fn();
		const view = render(AgentPanelConversationEntry, {
			props: {
				entry: {
					id: "user-entry",
					type: "user",
					text: "Open @[file:src/app.ts]",
				},
				onUserFileSelect,
			},
		});

		const chip = view.container.querySelector("[data-file-path='src/app.ts']");
		expect(chip?.tagName.toLowerCase()).toBe("button");
		await fireEvent.click(chip as Element);

		expect(onUserFileSelect).toHaveBeenCalledWith({
			tokenType: "file",
			value: "src/app.ts",
		});
	});

	it("submits a typed Other answer with Enter", async () => {
		const onQuestionSelect = vi.fn();
		const view = render(AgentPanelConversationEntry, {
			props: {
				entry: {
					id: "question-tool-entry",
					type: "tool_call",
					kind: "question",
					title: "Question",
					status: "running",
					interactionId: "question-interaction",
					question: {
						question: "Which behavior should we keep?",
						header: "Choice",
						options: [{ label: "Default", description: "Use default behavior" }],
						multiSelect: false,
					},
				},
				onQuestionSelect,
			},
		});

		const input = view.getByPlaceholderText("Other...");
		await fireEvent.input(input, { target: { value: "Custom answer" } });
		await fireEvent.keyDown(input, { key: "Enter" });

		expect(onQuestionSelect).toHaveBeenCalledWith({
			entryId: "question-tool-entry",
			interactionId: "question-interaction",
			questionIndex: 0,
			label: "Custom answer",
			multiSelect: false,
		});
	});
});
