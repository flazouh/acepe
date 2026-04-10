import { describe, expect, it } from "vitest";

import { shouldInterruptComposerStream } from "../interrupt-shortcut.js";

function createKeyboardEventLike(
	overrides: Partial<{
		key: string;
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
		repeat: boolean;
	}> = {}
) {
	return {
		key: "c",
		ctrlKey: true,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		...overrides,
	};
}

describe("interrupt-shortcut", () => {
	it("interrupts when macOS Control+C is pressed in a streaming composer", () => {
		expect(
			shouldInterruptComposerStream({
				isMac: true,
				isStreaming: true,
				event: createKeyboardEventLike(),
			})
		).toBe(true);
	});

	it("does not interrupt when the composer is idle", () => {
		expect(
			shouldInterruptComposerStream({
				isMac: true,
				isStreaming: false,
				event: createKeyboardEventLike(),
			})
		).toBe(false);
	});

	it("does not steal Control+C off macOS", () => {
		expect(
			shouldInterruptComposerStream({
				isMac: false,
				isStreaming: true,
				event: createKeyboardEventLike(),
			})
		).toBe(false);
	});
});
