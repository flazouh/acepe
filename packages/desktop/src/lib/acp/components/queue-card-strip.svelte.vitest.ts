import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import QueueCardStripHarness from "./__tests__/queue-card-strip.test-harness.svelte";

describe("QueueCardStrip", () => {
	afterEach(() => {
		cleanup();
	});

	it("allows editing a queued message", async () => {
		render(QueueCardStripHarness, {
			sessionId: "session-1",
			messages: [{ content: "first queued message", attachments: [] }],
		});

		await fireEvent.click(screen.getByRole("button", { name: /queued/i }));
		await fireEvent.click(screen.getByRole("button", { name: "Edit" }));

		const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
		await fireEvent.input(editor, { target: { value: "updated queued message" } });
		await fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(screen.getByText("updated queued message")).toBeTruthy();
	});

	it("allows deleting a queued message", async () => {
		render(QueueCardStripHarness, {
			sessionId: "session-1",
			messages: [{ content: "message to delete", attachments: [] }],
		});

		await fireEvent.click(screen.getByRole("button", { name: /queued/i }));
		await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		expect(screen.queryByText("message to delete")).toBeNull();
		expect(screen.queryByRole("button", { name: /queued/i })).toBeNull();
	});
});
