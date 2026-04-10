import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageQueueStore } from "$lib/acp/store/message-queue/index.js";

import QueueCardStripHarness from "./__tests__/queue-card-strip.test-harness.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../node_modules/svelte/src/index-client.js")
);

function requireStore(store: MessageQueueStore | null): MessageQueueStore {
	if (!store) {
		throw new Error("Queue store was not provided by the test harness");
	}
	return store;
}

describe("QueueCardStrip", () => {
	afterEach(() => {
		cleanup();
	});

	it("allows editing a queued message", async () => {
		let store: MessageQueueStore | null = null;
		render(QueueCardStripHarness, {
			sessionId: "session-1",
			messages: [{ content: "first queued message", attachments: [] }],
			onStoreReady: (value: MessageQueueStore) => {
				store = value;
			},
		});

		await fireEvent.click(screen.getByRole("button", { name: "Edit" }));

		const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
		await fireEvent.input(editor, { target: { value: "updated queued message" } });
		await fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(requireStore(store).getQueue("session-1")[0]?.content).toBe("updated queued message");
	});

	it("allows deleting a queued message", async () => {
		let store: MessageQueueStore | null = null;
		render(QueueCardStripHarness, {
			sessionId: "session-1",
			messages: [{ content: "message to delete", attachments: [] }],
			onStoreReady: (value: MessageQueueStore) => {
				store = value;
			},
		});

		await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		expect(requireStore(store).getQueue("session-1")).toEqual([]);
	});

	it("shows the newest queued message first", () => {
		const { container } = render(QueueCardStripHarness, {
			sessionId: "session-1",
			messages: [
				{ content: "older queued message", attachments: [] },
				{ content: "newest queued message", attachments: [] },
			],
		});

		const rows = Array.from(container.querySelectorAll(".queue-message-row"));
		expect(rows[0]?.textContent).toContain("newest queued message");
		expect(rows[1]?.textContent).toContain("older queued message");
	});
});
