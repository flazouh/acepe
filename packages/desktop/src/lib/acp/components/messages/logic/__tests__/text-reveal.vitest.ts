import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTextReveal } from "../text-reveal.js";

// ---------------------------------------------------------------------------
// Controllable requestAnimationFrame queue
// ---------------------------------------------------------------------------

let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextRafId = 1;
let currentFrameTime = 0;

function installControllableRAF(): void {
	rafQueue = [];
	nextRafId = 1;
	currentFrameTime = 0;
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
		const id = nextRafId++;
		rafQueue.push({ id, cb });
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
		rafQueue = rafQueue.filter((entry) => entry.id !== id);
	});
}

/** Flush exactly one queued rAF callback. Returns true if a callback was run. */
function flushOneFrame(frameDurationMs = 1000 / 60): boolean {
	const entry = rafQueue.shift();
	if (!entry) return false;
	currentFrameTime += frameDurationMs;
	entry.cb(currentFrameTime);
	return true;
}

/** Flush all queued rAF callbacks (up to a limit to prevent infinite loops). */
function flushAllFrames(limit = 500, frameDurationMs = 1000 / 60): number {
	let count = 0;
	while (rafQueue.length > 0 && count < limit) {
		flushOneFrame(frameDurationMs);
		count++;
	}
	return count;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function visibleText(container: HTMLElement): string {
	let result = "";
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		result += node.textContent || "";
	}
	return result;
}

/**
 * Flush MutationObserver microtasks.
 * happy-dom delivers MutationObserver callbacks via queueMicrotask.
 * We yield to the macrotask queue to guarantee all microtasks have run.
 */
function flushObserver(): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTextReveal", () => {
	beforeEach(() => {
		installControllableRAF();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("preserves existing content on initialization (no masking)", () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hello world</p>";

		const reveal = createTextReveal(container);

		// Existing content should remain fully visible
		expect(visibleText(container)).toBe("Hello world");
		// No animation queued (already fully revealed)
		expect(rafQueue.length).toBe(0);

		reveal.destroy();
	});

	it("only animates NEW content arriving via DOM mutation", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hello</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// Existing "Hello" is fully visible
		expect(visibleText(container)).toBe("Hello");

		// New content arrives (simulates streaming chunk)
		container.innerHTML = "<p>Hello world</p>";
		await flushObserver();

		// Observer fires → re-indexes → masks new text, preserves revealed
		// "Hello" (5 chars) already revealed, " world" (6 chars) is new
		// Frame 1: reveals 3 new chars → "Hello wo"
		flushOneFrame();
		expect(visibleText(container)).toBe("Hello wo");

		// Frame 2: reveals 3 more → "Hello world"
		flushOneFrame();
		expect(visibleText(container)).toBe("Hello world");

		reveal.destroy();
	});

	it("does not re-animate completed messages when controller is recreated", () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Complete message</p>";

		// Simulates isStreaming briefly going true for a completed message
		const reveal = createTextReveal(container);

		// All text should remain visible — no masking, no animation
		expect(visibleText(container)).toBe("Complete message");
		expect(rafQueue.length).toBe(0);

		reveal.destroy();

		// Text stays intact after destroy
		expect(visibleText(container)).toBe("Complete message");
	});

	it("reveals multiple streaming chunks progressively", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>AB</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// Initial "AB" is visible
		expect(visibleText(container)).toBe("AB");

		// Chunk 2: "ABCD"
		container.innerHTML = "<p>ABCD</p>";
		await flushObserver();
		flushOneFrame(); // reveals 3 of the 2 new chars → all revealed
		expect(visibleText(container)).toBe("ABCD");

		// Chunk 3: "ABCDEFGHIJ" (6 new chars)
		container.innerHTML = "<p>ABCDEFGHIJ</p>";
		await flushObserver();
		flushOneFrame(); // reveals 3 → "ABCDEFG"
		expect(visibleText(container)).toBe("ABCDEFG");
		flushOneFrame(); // reveals 3 → "ABCDEFGHIJ"
		expect(visibleText(container)).toBe("ABCDEFGHIJ");

		reveal.destroy();
	});

	it("handles multiple text nodes across elements", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p><strong>AB</strong></p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);
		expect(visibleText(container)).toBe("AB");

		// New content with multiple text nodes
		container.innerHTML = "<p><strong>AB</strong> <em>CD</em></p>";
		await flushObserver();
		// 2 new chars: " " and "CD" minus existing "AB" = 3 new chars total
		flushAllFrames();
		expect(visibleText(container)).toBe("AB CD");

		reveal.destroy();
	});

	it("reveals characters across text-node boundaries in a single frame", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>AB</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		container.innerHTML = "<p>AB<strong>C</strong>DEF</p>";
		await flushObserver();

		flushOneFrame();
		expect(visibleText(container)).toBe("ABCDE");

		flushAllFrames();
		expect(visibleText(container)).toBe("ABCDEF");

		reveal.destroy();
	});

	it("skips elements with data-reveal-skip attribute", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hi</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// New content with badge
		container.innerHTML = "<p>Hi <span data-reveal-skip>BADGE</span> there</p>";
		await flushObserver();
		// Non-skip text: "Hi " (3) + " there" (6) = 9 total; 2 already revealed
		// Frame 1: +3 → 5 revealed → "Hi " full + " t" partial
		flushOneFrame();
		expect(visibleText(container)).toBe("Hi BADGE t");
		// Frame 2: +3 → 8 revealed → "Hi " full + " ther" partial
		flushOneFrame();
		expect(visibleText(container)).toBe("Hi BADGE ther");
		// Frame 3: +3 → 9 revealed → all done
		flushOneFrame();
		expect(visibleText(container)).toBe("Hi BADGE there");

		reveal.destroy();
	});

	it("preserves unrevealed text when a skip element mounts children mid-stream", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hello</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		container.innerHTML = "<p>Hello <span data-reveal-skip></span> there world</p>";
		await flushObserver();

		expect(visibleText(container)).toBe("Hello");

		const placeholder = container.querySelector("[data-reveal-skip]");
		if (!(placeholder instanceof HTMLElement)) {
			throw new Error("expected skip placeholder");
		}

		const badge = document.createElement("span");
		badge.textContent = "BADGE";
		placeholder.appendChild(badge);
		await flushObserver();

		expect(placeholder.style.display).toBe("none");

		flushAllFrames();
		expect(visibleText(container)).toBe("Hello BADGE there world");

		reveal.destroy();
	});

	it("skips SVG elements", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Code</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		container.innerHTML = "<p>Code <svg><text>icon</text></svg> here</p>";
		await flushObserver();
		flushAllFrames();
		// SVG text should remain untouched
		const svgText = container.querySelector("svg text");
		expect(svgText?.textContent).toBe("icon");
		expect(visibleText(container)).toContain("Code");
		expect(visibleText(container)).toContain("here");

		reveal.destroy();
	});

	it("handles rapid successive DOM mutations", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>A</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// Two rapid mutations before rAF fires
		container.innerHTML = "<p>AB</p>";
		container.innerHTML = "<p>ABC</p>";
		await flushObserver();

		flushAllFrames();
		expect(visibleText(container)).toBe("ABC");

		reveal.destroy();
	});

	it("coalesces repeated mutation reindexing until the next animation frame", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hello</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		const createTreeWalkerSpy = vi.spyOn(document, "createTreeWalker");
		createTreeWalkerSpy.mockClear();

		const textNode = container.querySelector("p")?.firstChild;
		if (!(textNode instanceof Text)) {
			throw new Error("expected text node");
		}

		textNode.textContent = "Hello there";
		await flushObserver();
		textNode.textContent = "Hello there again";
		await flushObserver();
		textNode.textContent = "Hello there again and again";
		await flushObserver();

		expect(createTreeWalkerSpy).toHaveBeenCalledTimes(1);

		flushOneFrame();

		expect(createTreeWalkerSpy).toHaveBeenCalledTimes(2);

		createTreeWalkerSpy.mockRestore();
		reveal.destroy();
	});

	it("keeps pending text intact when unrelated child mutations happen mid-reveal", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>AB</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		container.innerHTML = "<p>ABCDEFGHIJ</p>";
		await flushObserver();
		flushOneFrame();
		expect(visibleText(container)).toBe("ABCDE");

		const marker = document.createElement("span");
		marker.setAttribute("data-marker", "true");
		container.appendChild(marker);
		await flushObserver();

		flushAllFrames();
		expect(visibleText(container)).toBe("ABCDEFGHIJ");

		reveal.destroy();
	});

	it("animates in-place text node updates", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hello</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		const textNode = container.querySelector("p")?.firstChild;
		if (!(textNode instanceof Text)) {
			throw new Error("expected text node");
		}

		textNode.textContent = "Hello world";
		await flushObserver();

		expect(visibleText(container)).toBe("Hello");
		flushOneFrame();
		expect(visibleText(container)).toBe("Hello wo");
		flushOneFrame();
		expect(visibleText(container)).toBe("Hello world");

		reveal.destroy();
	});

	it("destroy restores all text content", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hi</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// New content arrives, partially revealed
		container.innerHTML = "<p>Hi there world</p>";
		await flushObserver();
		flushOneFrame(); // reveals 3 of 12 new chars

		// Destroy should restore full text
		reveal.destroy();
		expect(visibleText(container)).toBe("Hi there world");
	});

	it("destroy cancels pending animation frames", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>A</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// Trigger new content so animation starts
		container.innerHTML = "<p>ABCDEFGHIJ</p>";
		await flushObserver();
		expect(rafQueue.length).toBeGreaterThan(0);

		reveal.destroy();
		expect(rafQueue.length).toBe(0);
	});

	it("destroy handles detached text nodes gracefully", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hello</p>";

		const reveal = createTextReveal(container);

		// Replace DOM entirely (simulates {@html} re-render)
		container.innerHTML = "<p>New content</p>";
		await flushObserver();

		// destroy should not throw even though original text nodes are detached
		expect(() => reveal.destroy()).not.toThrow();
	});

	it("generation counter prevents stale rAF from running", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>A</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// New content triggers animation
		container.innerHTML = "<p>ABCDE</p>";
		await flushObserver();
		const staleEntry = rafQueue[0];
		expect(staleEntry).toBeDefined();

		// Another mutation increments generation
		container.innerHTML = "<p>ABCDEFGHIJ</p>";
		await flushObserver();

		flushOneFrame();

		// Should be animating with latest content
		const text = visibleText(container);
		expect(text.length).toBeGreaterThan(0);

		reveal.destroy();
	});

	it("handles empty container gracefully", () => {
		const container = document.createElement("div");

		const reveal = createTextReveal(container);

		expect(rafQueue.length).toBe(0);
		expect(visibleText(container)).toBe("");

		reveal.destroy();
	});

	it("handles content with only skip elements", () => {
		const container = document.createElement("div");
		container.innerHTML = "<span data-reveal-skip>badge</span>";

		const reveal = createTextReveal(container);

		expect(container.textContent).toBe("badge");
		expect(rafQueue.length).toBe(0);

		reveal.destroy();
	});

	it("correctly handles many text nodes with new content", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<span>AB</span><span>CD</span>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);
		expect(visibleText(container)).toBe("ABCD");

		// Add many more nodes
		container.innerHTML =
			"<span>AB</span><span>CD</span><span>EF</span><span>GH</span><span>IJ</span>" +
			"<span>KL</span><span>MN</span><span>OP</span><span>QR</span><span>ST</span>";
		await flushObserver();

		// 4 chars revealed, 16 new → animate new chars
		flushOneFrame(); // 3 more → 7 total
		expect(visibleText(container)).toBe("ABCDEFG");

		flushOneFrame(); // 3 more → 10 total
		expect(visibleText(container)).toBe("ABCDEFGHIJ");

		reveal.destroy();
	});

	it("uses adaptive speed when falling behind", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>X</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// New content with 300 new chars — exceeds adaptive gap threshold
		container.innerHTML = `<p>X${"A".repeat(300)}</p>`;
		await flushObserver();

		flushOneFrame();
		// Should reveal more than BASE_CHARS_PER_FRAME (3) per frame when far behind
		const revealedLength = visibleText(container).length;
		expect(revealedLength).toBeGreaterThan(1 + 3); // existing "X" + more than base speed
		expect(revealedLength).toBeLessThan(1 + 40);

		reveal.destroy();
	});

	it("does not flush the entire backlog in a single frame for huge gaps", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>X</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// Large enough gap to require catch-up, but still reveal progressively.
		container.innerHTML = `<p>X${"A".repeat(1000)}</p>`;
		await flushObserver();

		flushOneFrame();
		const revealedLength = visibleText(container).length;
		expect(revealedLength).toBeGreaterThan(1 + 3);
		expect(revealedLength).toBeLessThan(1 + 50);

		reveal.destroy();
	});

	it("handles content shrinking during animation", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>ABCDEFGHIJKLMNOP</p>"; // 16 chars

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// Start animating new content
		container.innerHTML = "<p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>"; // 26 chars
		await flushObserver();
		flushOneFrame(); // partially revealed

		// Subtree replaced with shorter content (e.g., markdown re-render changes structure)
		container.innerHTML = "<p>ABCDE</p>"; // 5 chars
		await flushObserver();
		flushAllFrames();

		expect(visibleText(container)).toBe("ABCDE");

		reveal.destroy();
	});

	it("continues animating correctly after markdown syntax resolution reduces totalChars", async () => {
		const container = document.createElement("div");
		// "Hello **world" renders as literal text — 13 text-node chars including the "**"
		container.innerHTML = "<p>Hello **world</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);
		// Existing 13 chars are pre-revealed
		expect(visibleText(container)).toBe("Hello **world");

		// Step 1: Markdown resolves — "**world**" → <strong>world</strong>.
		// Text nodes drop to 11 chars. revealedChars(13) > totalChars(11) WITHOUT the clamp.
		container.innerHTML = "<p>Hello <strong>world</strong></p>";
		await flushObserver();

		// All 11 chars visible, no animation queued — same with or without the fix here.
		expect(visibleText(container)).toBe("Hello world");
		expect(rafQueue.length).toBe(0);

		// Step 2: New streaming content arrives (8 more chars, totalChars = 19).
		container.innerHTML = "<p>Hello <strong>world</strong> is great</p>";
		await flushObserver();

		// Assert BEFORE any rAF flush — this is where the two paths diverge:
		// WITH fix:    revealedChars was clamped to 11 in step 1 → applyMask shows 11 chars
		// WITHOUT fix: revealedChars stayed 13 in step 1 → applyMask shows 13 chars here
		expect(visibleText(container)).toBe("Hello world"); // 11 chars, not 13

		// Animation reveals the remaining 8 chars
		flushAllFrames();
		expect(visibleText(container)).toBe("Hello world is great");

		reveal.destroy();
	});

	it("clamps revealedChars when totalChars shrinks with no new content arriving", async () => {
		const container = document.createElement("div");
		// "Hello **world" renders as literal text — 13 text-node chars
		container.innerHTML = "<p>Hello **world</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);
		expect(visibleText(container)).toBe("Hello **world");

		// Syntax resolves with no new content: 11 text chars total
		container.innerHTML = "<p>Hello <strong>world</strong></p>";
		await flushObserver();

		// Assert BEFORE any rAF flush — without clamp, revealedChars(13) > totalChars(11)
		// would have revealed everything; with clamp revealedChars = min(13,11) = 11 = totalChars,
		// so all 11 chars should still be visible (correct — the old content is "fully revealed")
		expect(visibleText(container)).toBe("Hello world");
		// No animation should be queued — revealedChars === totalChars
		expect(rafQueue.length).toBe(0);

		reveal.destroy();
	});

	it("destroy mid-animation reveals all remaining text", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Short</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		// Large content arrives
		container.innerHTML = "<p>Short followed by much longer text content here</p>";
		await flushObserver();

		// Only one frame — partially revealed
		flushOneFrame();
		const partialLength = visibleText(container).length;
		expect(partialLength).toBeLessThan("Short followed by much longer text content here".length);

		// Simulate isStreaming → false (component calls destroy)
		reveal.destroy();

		// ALL text must be visible now
		expect(visibleText(container)).toBe("Short followed by much longer text content here");
	});

	it("reveals all pending text immediately when streaming stops", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hi</p>";

		const reveal = createTextReveal(container);
		reveal.setStreaming(true);

		container.innerHTML = "<p>Hi there world</p>";
		await flushObserver();
		flushOneFrame();

		expect(visibleText(container)).not.toBe("Hi there world");

		reveal.setStreaming(false);

		expect(visibleText(container)).toBe("Hi there world");
		expect(rafQueue.length).toBe(0);

		reveal.destroy();
	});

	it("does not animate DOM mutations while streaming is inactive", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hi</p>";

		const reveal = createTextReveal(container);

		container.innerHTML = "<p>Hi there</p>";
		await flushObserver();

		expect(visibleText(container)).toBe("Hi there");
		expect(rafQueue.length).toBe(0);

		reveal.destroy();
	});

	it("only animates content that arrives after streaming resumes", async () => {
		const container = document.createElement("div");
		container.innerHTML = "<p>Hello</p>";

		const reveal = createTextReveal(container);

		container.innerHTML = "<p>Hello world</p>";
		await flushObserver();
		expect(visibleText(container)).toBe("Hello world");

		reveal.setStreaming(true);
		container.innerHTML = "<p>Hello world again</p>";
		await flushObserver();

		flushOneFrame();
		expect(visibleText(container)).toBe("Hello world ag");

		flushAllFrames();
		expect(visibleText(container)).toBe("Hello world again");

		reveal.destroy();
	});

	// -----------------------------------------------------------------------
	// Element visibility during typewriter reveal
	// -----------------------------------------------------------------------

	describe("element visibility", () => {
		/** Helper: check if an element is hidden by inline display:none */
		function isHidden(el: HTMLElement): boolean {
			return el.style.display === "none";
		}

		it("hides list items whose text has not been reached", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<ul><li>first</li></ul>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);
			// "first" (5 chars) already revealed — li should be visible
			const li1 = container.querySelector("li")!;
			expect(isHidden(li1)).toBe(false);

			// New content: second list item added
			container.innerHTML = "<ul><li>first</li><li>second</li></ul>";
			await flushObserver();

			const [item1, item2] = container.querySelectorAll("li");
			// First item: text already revealed → visible
			expect(isHidden(item1 as HTMLElement)).toBe(false);
			// Second item: text not yet reached → hidden
			expect(isHidden(item2 as HTMLElement)).toBe(true);

			// Animate until all revealed
			flushAllFrames();
			expect(isHidden(item2 as HTMLElement)).toBe(false);

			reveal.destroy();
		});

		it("hides data-reveal-skip elements until preceding text is revealed", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>See commit </p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);
			expect(visibleText(container)).toBe("See commit ");

			// Badge arrives after the text
			container.innerHTML =
				'<p>See commit <span data-reveal-skip>BADGE</span> for details</p>';
			await flushObserver();

			const badge = container.querySelector("[data-reveal-skip]") as HTMLElement;
			// Badge charPosition = 11 (end of "See commit "). revealedChars = 11.
			// Skip elements use strict < : 11 < 11 is false → badge is visible.
			expect(isHidden(badge)).toBe(false); // preceding text fully revealed

			// Now test a badge that's ahead of the cursor
			container.innerHTML =
				'<p>See commit <span data-reveal-skip>BADGE</span> for details and also <span data-reveal-skip>BADGE2</span> here</p>';
			await flushObserver();

			const badges = container.querySelectorAll("[data-reveal-skip]");
			const badge1 = badges[0] as HTMLElement;
			const badge2 = badges[1] as HTMLElement;

			// badge1 position = 11 (after "See commit "), revealedChars = 11 → visible
			expect(isHidden(badge1)).toBe(false);
			// badge2 position = after "See commit " + " for details and also " = 11 + 22 = 33
			// revealedChars = 11 < 33 → hidden
			expect(isHidden(badge2)).toBe(true);

			// Animate to completion
			flushAllFrames();
			expect(isHidden(badge2)).toBe(false);

			reveal.destroy();
		});

		it("hides pre blocks whose text has not been reached", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>Hello</p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			// Code block arrives after existing text
			container.innerHTML = "<p>Hello</p><pre><code>const x = 1;</code></pre>";
			await flushObserver();

			const pre = container.querySelector("pre") as HTMLElement;
			// "Hello" = 5 chars revealed. Pre's first text starts at char 5.
			// revealedChars = 5 <= 5 → hidden (text not yet reached)
			expect(isHidden(pre)).toBe(true);

			// One frame reveals some code text
			flushOneFrame();
			expect(isHidden(pre)).toBe(false);

			reveal.destroy();
		});

		it("restores hidden elements on destroy", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>first</p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			container.innerHTML = "<p>first</p><p>second</p><p>third</p>";
			await flushObserver();

			const paragraphs = container.querySelectorAll("p");
			// Some paragraphs should be hidden
			expect(isHidden(paragraphs[2] as HTMLElement)).toBe(true);

			reveal.destroy();

			// All elements should be restored (no display:none)
			for (const p of paragraphs) {
				expect(isHidden(p as HTMLElement)).toBe(false);
			}
		});

		it("shows all hidden elements when streaming stops", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<ul><li>a</li></ul>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			container.innerHTML = "<ul><li>a</li><li>b</li><li>c</li></ul>";
			await flushObserver();

			const items = container.querySelectorAll("li");
			expect(isHidden(items[2] as HTMLElement)).toBe(true);

			reveal.setStreaming(false);

			// All items visible after streaming stops
			for (const item of items) {
				expect(isHidden(item as HTMLElement)).toBe(false);
			}

			reveal.destroy();
		});

		it("does not hide elements when not streaming", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<ul><li>a</li><li>b</li></ul>";

			const reveal = createTextReveal(container);
			// Not streaming — all elements should be visible

			const items = container.querySelectorAll("li");
			for (const item of items) {
				expect(isHidden(item as HTMLElement)).toBe(false);
			}

			reveal.destroy();
		});

		it("skips nested blocks when outer ancestor is already tracked", async () => {
			const container = document.createElement("div");
			// MarkdownIt renders tight lists as <li><p>text</p></li>
			container.innerHTML = "<ul><li><p>aaa</p></li></ul>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			// Add a second item with nested <p>
			container.innerHTML =
				"<ul><li><p>aaa</p></li><li><p>bbb</p></li></ul>";
			await flushObserver();

			const items = container.querySelectorAll("li");
			const innerP = items[1]!.querySelector("p") as HTMLElement;

			// Outer li is hidden — inner p should NOT independently get display:none
			// (if it did, unhiding the li later would still leave p hidden)
			expect(isHidden(items[1] as HTMLElement)).toBe(true);
			expect(isHidden(innerP)).toBe(false);

			// After animation, everything visible
			flushAllFrames();
			expect(isHidden(items[1] as HTMLElement)).toBe(false);
			expect(visibleText(container)).toBe("aaabbb");

			reveal.destroy();
		});

		it("hides hr elements until cursor reaches them", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>Above</p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			container.innerHTML = "<p>Above</p><hr><p>Below</p>";
			await flushObserver();

			const hr = container.querySelector("hr") as HTMLElement;
			// "Above" = 5 chars revealed. hr is at position 5. 5 <= 5 → hidden
			expect(isHidden(hr)).toBe(true);

			// Animate past hr position
			flushOneFrame();
			expect(isHidden(hr)).toBe(false);

			reveal.destroy();
		});
	});

	// -----------------------------------------------------------------------
	// Fade span edge cases
	// -----------------------------------------------------------------------

	describe("fade span", () => {
		it("preserves inline formatting when stableLen is 0", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>Hi </p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			// New content: bold text that starts at the frontier
			container.innerHTML = "<p>Hi <strong>bold</strong></p>";
			await flushObserver();

			// "Hi " = 3 chars already revealed. "bold" = 4 new chars.
			// stableLen = 0 for the "bold" text node — the fade span must stay
			// inside <strong>, not escape as a sibling.
			flushOneFrame();
			const strong = container.querySelector("strong");
			expect(strong).not.toBeNull();
			// The fade span should be inside <strong>, preserving bold styling
			const spanInStrong = strong!.querySelector("span");
			expect(spanInStrong).not.toBeNull();
			expect(visibleText(container)).toContain("bo");

			flushAllFrames();
			expect(visibleText(container)).toBe("Hi bold");

			reveal.destroy();
		});

		it("cleans up fade span on mid-fade DOM replacement", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>AB</p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			// Trigger content with fade span
			container.innerHTML = "<p>ABCDEFGHIJ</p>";
			await flushObserver();
			flushOneFrame(); // partially revealed with fade span

			// External DOM replacement wipes the fade span
			container.innerHTML = "<p>ABCDEFGHIJKLMNO</p>";
			await flushObserver();

			// Should not throw and should continue animating
			flushAllFrames();
			expect(visibleText(container)).toBe("ABCDEFGHIJKLMNO");

			reveal.destroy();
		});

		it("handles hr as the very last element", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>Above</p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			container.innerHTML = "<p>Above</p><hr>";
			await flushObserver();

			const hr = container.querySelector("hr") as HTMLElement;
			expect(hr).not.toBeNull();
			// hr at the end has charPos = totalChars. With inclusive comparison
			// (revealedChars <= charPos), it stays hidden while streaming — there's
			// no text after it to advance the cursor past its position.
			expect(hr.style.display).toBe("none");

			flushAllFrames();
			// Still hidden — revealedChars === totalChars === charPos
			expect(hr.style.display).toBe("none");

			// Unhidden when streaming stops (isStreaming becomes false)
			reveal.setStreaming(false);
			expect(hr.style.display).not.toBe("none");

			reveal.destroy();
		});

		it("destroy works when hideableElements are detached from DOM", async () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>first</p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);

			container.innerHTML = "<p>first</p><p>second</p>";
			await flushObserver();

			// Replace DOM entirely — old paragraph references are now detached
			container.innerHTML = "<p>different content</p>";
			await flushObserver();

			// destroy should not throw on detached hideableElements
			expect(() => reveal.destroy()).not.toThrow();
		});

		it("setStreaming(true) twice is idempotent", () => {
			const container = document.createElement("div");
			container.innerHTML = "<p>Hello</p>";

			const reveal = createTextReveal(container);
			reveal.setStreaming(true);
			reveal.setStreaming(true); // should be no-op

			expect(visibleText(container)).toBe("Hello");
			expect(rafQueue.length).toBe(0);

			reveal.destroy();
		});
	});
});
