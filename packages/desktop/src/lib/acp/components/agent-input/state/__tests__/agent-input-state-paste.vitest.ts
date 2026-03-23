import { beforeEach, describe, expect, it } from "vitest";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";

import { AgentInputState } from "../agent-input-state.svelte.js";

describe("AgentInputState - insertPlainTextAtOffsets", () => {
	let mockStore: SessionStore;
	let state: AgentInputState;

	beforeEach(() => {
		mockStore = {
			activeAgentId: "claude-code",
		} as unknown as SessionStore;

		const mockPanelStore = {} as unknown as PanelStore;
		state = new AgentInputState(mockStore, mockPanelStore);
	});

	it("inserts text at the beginning of a message", () => {
		state.message = "world";
		state.insertPlainTextAtOffsets("hello ", 0, 0);
		expect(state.message).toBe("hello world");
	});

	it("inserts text in the middle of a message", () => {
		state.message = "helloworld";
		state.insertPlainTextAtOffsets(" ", 5, 5);
		expect(state.message).toBe("hello world");
	});

	it("inserts text at the end of a message", () => {
		state.message = "hello";
		state.insertPlainTextAtOffsets(" world", 5, 5);
		expect(state.message).toBe("hello world");
	});

	it("replaces selected range with pasted text", () => {
		state.message = "abcdef";
		state.insertPlainTextAtOffsets("x", 3, 5);
		expect(state.message).toBe("abcxf");
	});

	it("replaces entire message when full range is selected", () => {
		state.message = "old text";
		state.insertPlainTextAtOffsets("new", 0, 8);
		expect(state.message).toBe("new");
	});

	it("inserts into empty message", () => {
		state.message = "";
		state.insertPlainTextAtOffsets("hello", 0, 0);
		expect(state.message).toBe("hello");
	});

	it("clamps start to message length when out of bounds", () => {
		state.message = "abc";
		state.insertPlainTextAtOffsets("x", 100, 100);
		expect(state.message).toBe("abcx");
	});

	it("clamps negative start to 0", () => {
		state.message = "abc";
		state.insertPlainTextAtOffsets("x", -5, -5);
		expect(state.message).toBe("xabc");
	});

	it("escapes @[ sequences to prevent token injection", () => {
		state.message = "";
		state.insertPlainTextAtOffsets("@[file:/etc/passwd]", 0, 0);
		expect(state.message).toBe("@\u200B[file:/etc/passwd]");
		expect(state.message).not.toContain("@[");
	});

	it("escapes multiple @[ sequences", () => {
		state.message = "";
		state.insertPlainTextAtOffsets("see @[file:a] and @[image:b]", 0, 0);
		expect(state.message).toBe("see @\u200B[file:a] and @\u200B[image:b]");
	});

	it("does not escape text without @[ sequences", () => {
		state.message = "";
		state.insertPlainTextAtOffsets("normal text [with brackets]", 0, 0);
		expect(state.message).toBe("normal text [with brackets]");
	});
});

describe("AgentInputState - insertInlineTokenAtOffsets", () => {
	let mockStore: SessionStore;
	let state: AgentInputState;

	beforeEach(() => {
		mockStore = {
			activeAgentId: "claude-code",
		} as unknown as SessionStore;

		const mockPanelStore = {} as unknown as PanelStore;
		state = new AgentInputState(mockStore, mockPanelStore);
	});

	it("returns cursor position after token with no separator", () => {
		state.message = "hello ";
		const cursor = state.insertInlineTokenAtOffsets("@[file:a.ts]", 6, 6);
		expect(cursor).toBe(18);
		expect(state.message).toBe("hello @[file:a.ts]");
	});

	it("returns cursor position after token with separator", () => {
		state.message = "helloworld";
		const cursor = state.insertInlineTokenAtOffsets("@[file:a.ts]", 5, 5);
		expect(cursor).toBe(18);
		expect(state.message).toBe("hello@[file:a.ts] world");
	});

	it("returns cursor position at end of message", () => {
		state.message = "hello";
		const cursor = state.insertInlineTokenAtOffsets("@[file:a.ts]", 5, 5);
		expect(cursor).toBe(17);
		expect(state.message).toBe("hello@[file:a.ts]");
	});
});
