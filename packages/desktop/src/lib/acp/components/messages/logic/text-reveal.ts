/** Base reveal speed in characters per second. */
const BASE_CHARS_PER_SECOND = 180;

/** Gap threshold before adaptive speed kicks in */
const ADAPTIVE_GAP_THRESHOLD = 200;

/** Maximum speed multiplier applied when catching up to buffered content. */
const MAX_ADAPTIVE_MULTIPLIER = 12;

/** Default frame duration used for the first scheduled frame. */
const DEFAULT_FRAME_DURATION_MS = 1000 / 60;

/** Selector for elements whose text nodes should NOT be revealed */
const REVEAL_SKIP_SELECTOR = "svg, [data-reveal-skip]";

/** Block elements that cause visual artifacts (bullets, backgrounds, borders) when unrevealed */
const HIDEABLE_BLOCK_SELECTOR =
	"p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, table, hr, .table-wrapper, .code-block-wrapper";

interface TextNodeEntry {
	node: Text;
	original: string;
	startIndex: number;
}

interface HideableEntry {
	element: HTMLElement;
	charPosition: number;
	/**
	 * Controls the hide/show threshold comparison:
	 * - true (blocks): hidden while `revealedChars <= charPosition` — stays hidden until
	 *   at least one character inside the block is revealed (prevents empty bullets/backgrounds).
	 * - false (skips): hidden while `revealedChars < charPosition` — shown as soon as all
	 *   preceding text is fully revealed (badges appear the instant the cursor reaches them).
	 */
	inclusive: boolean;
}

export interface TextRevealController {
	setStreaming(isStreaming: boolean): void;
	destroy(): void;
}

export function createTextReveal(container: HTMLElement): TextRevealController {
	const textNodes: TextNodeEntry[] = [];
	const hideableElements: HideableEntry[] = [];
	let totalChars = 0;
	let animFrameId: number | null = null;
	let isStreaming = false;
	let lastFrameTime: number | null = null;

	function indexTextNodes() {
		textNodes.length = 0;
		totalChars = 0;
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
			acceptNode(node: Node) {
				const parent = (node as Text).parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				if (parent.closest(REVEAL_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		// TreeWalker with SHOW_TEXT guarantees Text nodes
		let node: Text | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard walker loop
		while ((node = walker.nextNode() as Text | null)) {
			const original = node.textContent ?? "";
			textNodes.push({ node, original, startIndex: totalChars });
			totalChars += original.length;
		}
	}

	function indexHideableElements() {
		hideableElements.length = 0;

		// Block elements: hide until first character inside is revealed.
		// Skip nested blocks whose ancestor already matches — the outer element's
		// display:none already hides everything inside it.
		const blocks = container.querySelectorAll(HIDEABLE_BLOCK_SELECTOR);
		for (const block of blocks) {
			if (block.parentElement?.closest(HIDEABLE_BLOCK_SELECTOR)) continue;

			let charPos = -1;
			for (const entry of textNodes) {
				if (block.contains(entry.node)) {
					charPos = entry.startIndex;
					break;
				}
			}
			if (charPos === -1) {
				// No text nodes (e.g. <hr>) — position by the first text node after it
				for (const entry of textNodes) {
					if (block.compareDocumentPosition(entry.node) & Node.DOCUMENT_POSITION_FOLLOWING) {
						charPos = entry.startIndex;
						break;
					}
				}
				if (charPos === -1) charPos = totalChars;
			}
			hideableElements.push({ element: block as HTMLElement, charPosition: charPos, inclusive: true });
		}

		// Skip elements (badges): show once all preceding text is fully revealed.
		// Default charPos = 0 means "show immediately" when no text precedes the element.
		const skips = container.querySelectorAll("[data-reveal-skip]");
		for (const skip of skips) {
			let charPos = 0;
			for (let i = textNodes.length - 1; i >= 0; i--) {
				const entry = textNodes[i];
				if (skip.compareDocumentPosition(entry.node) & Node.DOCUMENT_POSITION_PRECEDING) {
					charPos = entry.startIndex + entry.original.length;
					break;
				}
			}
			hideableElements.push({ element: skip as HTMLElement, charPosition: charPos, inclusive: false });
		}
	}

	function applyElementVisibility() {
		for (const entry of hideableElements) {
			const shouldHide = entry.inclusive
				? revealedChars <= entry.charPosition
				: revealedChars < entry.charPosition;

			if (isStreaming && shouldHide) {
				entry.element.style.display = "none";
			} else {
				entry.element.style.removeProperty("display");
			}
		}
	}

	// Index existing content and treat it as already revealed.
	// Only NEW content (arriving via DOM mutations) will be animated.
	indexTextNodes();
	indexHideableElements();
	let revealedChars = totalChars;
	applyMask();

	function applyMask() {
		for (const entry of textNodes) {
			if (!container.contains(entry.node)) continue;
			const end = entry.startIndex + entry.original.length;
			if (revealedChars >= end) {
				if (entry.node.textContent !== entry.original) entry.node.textContent = entry.original;
			} else if (revealedChars > entry.startIndex) {
				entry.node.textContent = entry.original.slice(0, revealedChars - entry.startIndex);
			} else {
				if (entry.node.textContent !== "") entry.node.textContent = "";
			}
		}
		applyElementVisibility();
	}

	function stopAnimation() {
		if (animFrameId !== null) {
			cancelAnimationFrame(animFrameId);
			animFrameId = null;
		}
		lastFrameTime = null;
	}

	function calculateCharsPerFrame(gap: number, elapsedMs: number): number {
		const safeElapsedMs = elapsedMs > 0 ? elapsedMs : DEFAULT_FRAME_DURATION_MS;
		const baseChars = Math.max(
			1,
			Math.round((BASE_CHARS_PER_SECOND * safeElapsedMs) / 1000)
		);

		if (gap <= ADAPTIVE_GAP_THRESHOLD) {
			return baseChars;
		}

		const adaptiveMultiplier = Math.min(
			MAX_ADAPTIVE_MULTIPLIER,
			Math.max(2, Math.ceil(gap / ADAPTIVE_GAP_THRESHOLD))
		);

		return baseChars * adaptiveMultiplier;
	}

	function scheduleAnimation() {
		if (!isStreaming || animFrameId !== null || revealedChars >= totalChars) {
			return;
		}

		animFrameId = requestAnimationFrame((timestamp) => animate(timestamp));
	}

	function animate(frameTime: number) {
		animFrameId = null;

		if (!isStreaming) {
			lastFrameTime = null;
			return;
		}

		if (revealedChars >= totalChars) {
			lastFrameTime = null;
			return;
		}

		const elapsedMs =
			lastFrameTime === null ? DEFAULT_FRAME_DURATION_MS : Math.max(frameTime - lastFrameTime, 1);
		lastFrameTime = frameTime;

		const gap = totalChars - revealedChars;
		const speed = calculateCharsPerFrame(gap, elapsedMs);
		revealedChars = Math.min(revealedChars + speed, totalChars);
		applyMask();
		scheduleAnimation();
	}

	function onDomMutation() {
		indexTextNodes();
		indexHideableElements();
		// Clamp revealedChars to new totalChars in case it decreased.
		// Happens when markdown syntax resolves (e.g. literal "**" chars disappear as
		// <strong>) or on the loading→HTML transition. Without this, revealedChars > totalChars
		// causes applyMask() to reveal all content prematurely and scheduleAnimation() to skip.
		revealedChars = Math.min(revealedChars, totalChars);

		if (!isStreaming) {
			revealedChars = totalChars;
			applyMask();
			stopAnimation();
			return;
		}

		applyMask();
		scheduleAnimation();
	}

	const observer = new MutationObserver(onDomMutation);
	// INVARIANT: All content updates to this container MUST use subtree replacement
	// (e.g., {@html} or innerHTML), not in-place text node mutation. We only observe
	// childList (not characterData) because our applyMask() modifies Text node
	// textContent which fires characterData mutations — by not observing those, we
	// avoid self-triggering entirely. If a code path starts modifying text nodes
	// directly, the observer will miss it and the reveal animation will desync.
	observer.observe(container, {
		childList: true,
		subtree: true,
	});

	return {
		setStreaming(nextIsStreaming: boolean) {
			if (isStreaming === nextIsStreaming) {
				return;
			}

			isStreaming = nextIsStreaming;

			if (!isStreaming) {
				revealedChars = totalChars;
				applyMask();
				stopAnimation();
				return;
			}

			lastFrameTime = null;
		},
		destroy() {
			observer.disconnect();
			stopAnimation();
			// Restore all text nodes to full content (skip detached nodes)
			for (const entry of textNodes) {
				if (container.contains(entry.node) && entry.node.textContent !== entry.original) {
					entry.node.textContent = entry.original;
				}
			}
			// Restore any hidden elements
			for (const entry of hideableElements) {
				entry.element.style.removeProperty("display");
			}
		},
	};
}
