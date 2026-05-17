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
