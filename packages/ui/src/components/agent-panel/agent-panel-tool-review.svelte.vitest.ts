import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelConversationEntry from "./agent-panel-conversation-entry.svelte";

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

describe("AgentPanelToolReview", () => {
	it("renders edited files in a capped scroll area and calls review action", async () => {
		const onReview = vi.fn();

		render(AgentPanelConversationEntry, {
			props: {
				entry: {
					id: "local-review",
					type: "tool_call",
					kind: "review",
					title: "Edited files",
					status: "done",
					reviewFiles: [
						{
							id: "src/lib/alpha.ts",
							filePath: "src/lib/alpha.ts",
							fileName: "alpha.ts",
							additions: 12,
							deletions: 2,
						},
						{
							id: "src/lib/beta.ts",
							filePath: "src/lib/beta.ts",
							fileName: "beta.ts",
							additions: 3,
							deletions: 1,
						},
					],
				},
				onReview,
			},
		});

		const card = screen.getByTestId("agent-panel-tool-review");
		const fileList = screen.getByTestId("agent-panel-tool-review-files");
		const totalDiff = screen.getByTestId("agent-panel-tool-review-total-diff");
		const reviewButton = screen.getByRole("button", { name: "Review" });

		expect(card.textContent).toContain("Edited files");
		expect(card.textContent).toContain("alpha.ts");
		expect(card.textContent).toContain("beta.ts");
		expect(card.textContent).toContain("+12");
		expect(card.textContent).toContain("-2");
		expect(totalDiff.textContent).toContain("+15");
		expect(totalDiff.textContent).toContain("-3");
		expect(fileList.className).toContain("max-h-");
		expect(fileList.className).toContain("overflow-y-auto");
		expect(reviewButton.querySelector("svg")).toBeNull();

		await fireEvent.click(reviewButton);

		expect(onReview).toHaveBeenCalledWith({
			entryId: "local-review",
			toolCallId: undefined,
			interactionId: undefined,
		});
	});

	it("disables Review when there are no files", () => {
		render(AgentPanelConversationEntry, {
			props: {
				entry: {
					id: "local-review",
					type: "tool_call",
					kind: "review",
					title: "Edited files",
					status: "done",
					reviewFiles: [],
				},
				onReview: vi.fn(),
			},
		});

		const reviewButton = screen.getByRole("button", { name: "Review" }) as HTMLButtonElement;

		expect(reviewButton.disabled).toBe(true);
		expect(screen.getByText("No edited files")).toBeTruthy();
	});
});
