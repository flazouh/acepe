import { beforeEach, describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";

// Mock svelte context functions (no-op outside component lifecycle)
mock.module("svelte", () => ({
	getContext: () => null,
	setContext: () => {},
}));

// Ensure unique UUIDs even when other tests mock crypto
let uuidCounter = 0;
const originalRandomUUID = crypto.randomUUID.bind(crypto);
beforeEach(() => {
	uuidCounter = 0;
	crypto.randomUUID = () => {
		uuidCounter++;
		return `test-uuid-${uuidCounter}-${Date.now()}` as ReturnType<typeof crypto.randomUUID>;
	};
});

// Restore after all tests in this file
import { afterAll } from "bun:test";

afterAll(() => {
	crypto.randomUUID = originalRandomUUID;
});

import { ConnectionError } from "../../../errors/app-error.js";
import type { MessageSender } from "../message-queue-store.svelte.js";
import {
	createMessageQueueStore,
	serializeWithAttachments,
} from "../message-queue-store.svelte.js";

function makeAttachment(overrides: Partial<{ type: string; path: string; content: string }> = {}) {
	return {
		id: crypto.randomUUID(),
		type: (overrides.type ?? "file") as "file" | "image" | "text",
		path: overrides.path ?? "/test/file.ts",
		displayName: "file.ts",
		extension: "ts",
		content: overrides.content,
	};
}

function createMockSender(): MessageSender & {
	calls: Array<{ sessionId: string; content: string; attachments: readonly unknown[] }>;
} {
	const calls: Array<{ sessionId: string; content: string; attachments: readonly unknown[] }> = [];
	return {
		calls,
		sendMessage(sessionId: string, content: string, attachments: readonly unknown[] = []) {
			calls.push({ sessionId, content, attachments });
			return okAsync(undefined);
		},
	};
}

function createFailingSender(): MessageSender {
	return {
		sendMessage() {
			return errAsync(new ConnectionError("Failed to send"));
		},
	};
}

describe("serializeWithAttachments", () => {
	it("should return content as-is when no attachments", () => {
		expect(serializeWithAttachments("hello", [])).toBe("hello");
	});

	it("should prepend file attachment token", () => {
		const att = makeAttachment({ type: "file", path: "/src/main.ts" });
		const result = serializeWithAttachments("message", [att]);
		expect(result).toBe("@[file:/src/main.ts]\nmessage");
	});

	it("should prepend text attachment with base64 content", () => {
		const att = makeAttachment({ type: "text", content: "hello world" });
		const result = serializeWithAttachments("msg", [att]);
		expect(result).toMatch(/^@\[text:[A-Za-z0-9+/=]+\]\nmsg$/);
	});

	it("should join multiple attachments with spaces", () => {
		const att1 = makeAttachment({ type: "file", path: "/a.ts" });
		const att2 = makeAttachment({ type: "file", path: "/b.ts" });
		const result = serializeWithAttachments("msg", [att1, att2]);
		expect(result).toBe("@[file:/a.ts] @[file:/b.ts]\nmsg");
	});
});

describe("MessageQueueStore", () => {
	let sender: ReturnType<typeof createMockSender>;

	beforeEach(() => {
		sender = createMockSender();
	});

	describe("enqueue", () => {
		it("should add a message to the queue", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "hello", []);
			expect(store.queueCount("s1")).toBe(1);
		});

		it("should preserve message content and attachments", () => {
			const store = createMessageQueueStore(sender);
			const att = makeAttachment();
			store.enqueue("s1", "hello", [att]);

			const queue = store.getQueue("s1");
			expect(queue).toHaveLength(1);
			expect(queue[0].content).toBe("hello");
			expect(queue[0].attachments).toHaveLength(1);
		});

		it("should enforce MAX_QUEUE_SIZE of 5 and return false when full", () => {
			const store = createMessageQueueStore(sender);
			for (let i = 0; i < 5; i++) {
				expect(store.enqueue("s1", `msg-${i}`, [])).toBe(true);
			}
			expect(store.enqueue("s1", "msg-5", [])).toBe(false);
			expect(store.queueCount("s1")).toBe(5);
		});

		it("should maintain order (FIFO)", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "first", []);
			store.enqueue("s1", "second", []);
			store.enqueue("s1", "third", []);

			const queue = store.getQueue("s1");
			expect(queue[0].content).toBe("first");
			expect(queue[1].content).toBe("second");
			expect(queue[2].content).toBe("third");
		});

		it("should assign unique IDs to each message", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "a", []);
			store.enqueue("s1", "b", []);

			const queue = store.getQueue("s1");
			expect(queue[0].id).not.toBe(queue[1].id);
		});

		it("should keep separate queues per session", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "for-s1", []);
			store.enqueue("s2", "for-s2", []);

			expect(store.queueCount("s1")).toBe(1);
			expect(store.queueCount("s2")).toBe(1);
			expect(store.getQueue("s1")[0].content).toBe("for-s1");
			expect(store.getQueue("s2")[0].content).toBe("for-s2");
		});
	});

	describe("removeMessage", () => {
		it("should remove a specific message by ID", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "a", []);
			store.enqueue("s1", "b", []);

			const messageId = store.getQueue("s1")[0].id;
			store.removeMessage("s1", messageId);

			expect(store.queueCount("s1")).toBe(1);
			expect(store.getQueue("s1")[0].content).toBe("b");
		});

		it("should clean up when last message is removed", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "only", []);

			const messageId = store.getQueue("s1")[0].id;
			store.removeMessage("s1", messageId);

			expect(store.queueCount("s1")).toBe(0);
			expect(store.getQueue("s1")).toEqual([]);
		});

		it("should be safe when session has no queue", () => {
			const store = createMessageQueueStore(sender);
			store.removeMessage("nonexistent", "fake-id");
			expect(store.queueCount("nonexistent")).toBe(0);
		});
	});

	describe("updateMessage", () => {
		it("should update a specific queued message content", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "first", []);
			store.enqueue("s1", "second", []);

			const messageId = store.getQueue("s1")[0].id;
			expect(store.updateMessage("s1", messageId, "updated")).toBe(true);

			const queue = store.getQueue("s1");
			expect(queue[0].content).toBe("updated");
			expect(queue[1].content).toBe("second");
		});

		it("should return false when queued message does not exist", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "first", []);

			expect(store.updateMessage("s1", "missing", "updated")).toBe(false);
			expect(store.getQueue("s1")[0].content).toBe("first");
		});
	});

	describe("clearQueue", () => {
		it("should remove all messages for a session", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "a", []);
			store.enqueue("s1", "b", []);
			store.clearQueue("s1");

			expect(store.queueCount("s1")).toBe(0);
		});

		it("should not affect other sessions", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "a", []);
			store.enqueue("s2", "b", []);
			store.clearQueue("s1");

			expect(store.queueCount("s1")).toBe(0);
			expect(store.queueCount("s2")).toBe(1);
		});
	});

	describe("drainNext", () => {
		it("should send the first message in the queue", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "hello", []);
			store.drainNext("s1");

			expect(sender.calls).toHaveLength(1);
			expect(sender.calls[0].content).toBe("hello");
			expect(sender.calls[0].sessionId).toBe("s1");
		});

		it("should remove the drained message from the queue", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "first", []);
			store.enqueue("s1", "second", []);
			store.drainNext("s1");

			expect(store.queueCount("s1")).toBe(1);
			expect(store.getQueue("s1")[0].content).toBe("second");
		});

		it("should pass attachments separately when draining", () => {
			const store = createMessageQueueStore(sender);
			const att = makeAttachment({ type: "file", path: "/test.ts" });
			store.enqueue("s1", "hello", [att]);
			store.drainNext("s1");

			expect(sender.calls[0].content).toBe("hello");
			expect(sender.calls[0].attachments).toHaveLength(1);
			expect(sender.calls[0].attachments[0]).toMatchObject({ type: "file", path: "/test.ts" });
		});

		it("should not drain when queue is empty", () => {
			const store = createMessageQueueStore(sender);
			store.drainNext("s1");
			expect(sender.calls).toHaveLength(0);
		});

		it("should not drain when paused", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "hello", []);
			store.pause("s1");
			store.drainNext("s1");

			expect(sender.calls).toHaveLength(0);
			expect(store.queueCount("s1")).toBe(1);
		});
	});

	describe("pause / resume", () => {
		it("should track paused state", () => {
			const store = createMessageQueueStore(sender);
			expect(store.isPaused("s1")).toBe(false);
			store.pause("s1");
			expect(store.isPaused("s1")).toBe(true);
		});

		it("should resume and drain automatically", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "waiting", []);
			store.pause("s1");
			store.drainNext("s1"); // should be blocked

			expect(sender.calls).toHaveLength(0);

			store.resume("s1");
			expect(store.isPaused("s1")).toBe(false);
			expect(sender.calls).toHaveLength(1);
			expect(sender.calls[0].content).toBe("waiting");
		});
	});

	describe("drain failure", () => {
		it("should re-insert message at front and pause on send failure", async () => {
			const failingSender = createFailingSender();
			const store = createMessageQueueStore(failingSender);

			store.enqueue("s1", "will-fail", []);
			store.enqueue("s1", "second", []);
			store.drainNext("s1");

			// Allow the async ResultAsync to settle
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(store.isPaused("s1")).toBe(true);
			// Message should be re-inserted at front
			const queue = store.getQueue("s1");
			expect(queue[0].content).toBe("will-fail");
			expect(queue[1].content).toBe("second");
		});
	});

	describe("removeForSession", () => {
		it("should clean up all state for a session", () => {
			const store = createMessageQueueStore(sender);
			store.enqueue("s1", "msg", []);
			store.pause("s1");

			store.removeForSession("s1");

			expect(store.queueCount("s1")).toBe(0);
			expect(store.isPaused("s1")).toBe(false);
		});
	});

	describe("getQueue", () => {
		it("should return empty array for unknown session", () => {
			const store = createMessageQueueStore(sender);
			expect(store.getQueue("unknown")).toEqual([]);
		});
	});
});
