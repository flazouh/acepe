import { describe, expect, it } from "bun:test";

import { StreamingRevealEngine } from "../streaming-reveal-engine.js";

describe("StreamingRevealEngine", () => {
	it("reveals appended streaming text progressively instead of all at once", () => {
		const engine = new StreamingRevealEngine();

		engine.setSourceText("Hello world", true);
		const initial = engine.getSnapshot();
		expect(initial.displayedText).toBe("");
		expect(initial.mode).toBe("streaming");

		engine.advance(16);
		const afterOneFrame = engine.getSnapshot();
		expect(afterOneFrame.displayedText.length).toBeGreaterThan(0);
		expect(afterOneFrame.displayedText.length).toBeLessThan("Hello world".length);
		expect(afterOneFrame.mode).toBe("streaming");
	});

	it("enters paused-awaiting-more after the source stalls while the stream stays open", () => {
		const engine = new StreamingRevealEngine();

		engine.setSourceText("Hi", true);
		engine.advance(500);
		expect(engine.getSnapshot().displayedText).toBe("Hi");

		engine.advance(140);
		expect(engine.getSnapshot().mode).toBe("paused-awaiting-more");
		expect(engine.getSnapshot().cursorVisible).toBe(true);
	});

	it("switches to completion-catchup and drains to complete when streaming stops with backlog", () => {
		const engine = new StreamingRevealEngine();

		engine.setSourceText("This should finish smoothly", true);
		engine.advance(16);
		const partial = engine.getSnapshot().displayedText.length;
		expect(partial).toBeGreaterThan(0);

		engine.setSourceText("This should finish smoothly", false);
		expect(engine.getSnapshot().mode).toBe("completion-catchup");

		engine.advance(250);
		const completed = engine.getSnapshot();
		expect(completed.displayedText).toBe("This should finish smoothly");
		expect(completed.mode).toBe("complete");
		expect(completed.cursorVisible).toBe(false);
	});

	it("resets when the source text is replaced instead of appended", () => {
		const engine = new StreamingRevealEngine();

		engine.setSourceText("First message", true);
		engine.advance(32);
		expect(engine.getSnapshot().displayedText.length).toBeGreaterThan(0);

		engine.setSourceText("Second", true);
		const reset = engine.getSnapshot();
		expect(reset.displayedText).toBe("");
		expect(reset.mode).toBe("streaming");
		expect(reset.sourceText).toBe("Second");
	});

	it("seeds the first streaming snapshot so remounts do not replay from blank", () => {
		const engine = new StreamingRevealEngine();

		engine.setSourceText("Already streamed text", true, { seedFromSource: true });

		const snapshot = engine.getSnapshot();
		expect(snapshot.displayedText).toBe("Already streamed text");
		expect(snapshot.mode).toBe("streaming");
	});

	it("never reveals past the canonical source length even with a large frame gap", () => {
		const engine = new StreamingRevealEngine();

		engine.setSourceText("Short text", true);
		engine.advance(5_000);

		const snapshot = engine.getSnapshot();
		expect(snapshot.displayedText).toBe("Short text");
		expect(snapshot.revealedLength).toBe("Short text".length);
	});

	it("reveals whole grapheme clusters instead of splitting emoji sequences", () => {
		const engine = new StreamingRevealEngine();

		engine.setSourceText("👨‍👩‍👧‍👦abcdef", true);
		engine.advance(1);

		const snapshot = engine.getSnapshot();
		expect(snapshot.displayedText).toBe("👨‍👩‍👧‍👦");
	});
});
