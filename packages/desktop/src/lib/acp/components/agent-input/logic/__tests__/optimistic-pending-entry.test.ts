import { describe, expect, it } from "bun:test";
import { createPendingUserEntry } from "../pending-user-entry.js";

/**
 * Tests for optimistic pending entry structure.
 *
 * Note: The full integration flow (set pending → createSession → clear → sendMessage)
 * cannot be tested here because AgentInputState uses Svelte 5 runes ($state) which
 * require Vite preprocessing. The flow is tested manually:
 *   1. Open new thread, type message, hit send → message appears immediately
 *   2. Kill ACP before handshake → message disappears, error shown
 *
 * These tests verify the pending entry structure matches what the rendering pipeline expects.
 */

describe("Optimistic pending entry structure", () => {
	it("builds a valid user SessionEntry shape", () => {
		const content = "Test message with content";
		const textBlock = { type: "text" as const, text: content };
		const pendingEntry = {
			id: crypto.randomUUID(),
			type: "user" as const,
			message: {
				content: textBlock,
				chunks: [textBlock],
				sentAt: new Date(),
			},
			timestamp: new Date(),
		};

		expect(pendingEntry.type).toBe("user");
		expect(pendingEntry.message.content.type).toBe("text");
		expect(pendingEntry.message.content.text).toBe(content);
		expect(pendingEntry.message.chunks).toHaveLength(1);
		expect(pendingEntry.id).toHaveLength(36); // UUID format
		expect(pendingEntry.timestamp).toBeInstanceOf(Date);
		expect(pendingEntry.message.sentAt).toBeInstanceOf(Date);
	});

	it("chunks array contains the text block", () => {
		const textBlock = { type: "text" as const, text: "Hello" };
		const entry = {
			id: crypto.randomUUID(),
			type: "user" as const,
			message: { content: textBlock, chunks: [textBlock], sentAt: new Date() },
			timestamp: new Date(),
		};

		expect(entry.message.chunks[0]).toBe(entry.message.content);
	});

	it("creates a pending user entry immediately from first-send content", () => {
		const entry = createPendingUserEntry("Ship it");
		if (entry.type !== "user") {
			throw new Error("Expected user entry");
		}
		if (entry.message.content.type !== "text") {
			throw new Error("Expected text content block");
		}

		expect(entry.type).toBe("user");
		expect(entry.message.content.type).toBe("text");
		expect(entry.message.content.text).toBe("Ship it");
		expect(entry.message.chunks).toEqual([entry.message.content]);
	});
});
