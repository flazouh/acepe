import {
	advanceRevealProgress,
	clearRevealFrameTime,
	commitRenderedReveal,
	createRevealProgress,
	hasPendingReveal,
	syncRevealProgress,
	updateStreamingState,
	type RevealProgress,
} from "./text-reveal-model.js";
import { recordHotPathDiagnostic } from "../../../utils/hot-path-diagnostics.js";

/** Base reveal speed in characters per second. */
const REVEAL_SKIP_SELECTOR = "svg, [data-reveal-skip]";

/** Block elements that cause visual artifacts (bullets, backgrounds, borders) when unrevealed */
const HIDEABLE_BLOCK_SELECTOR =
	"p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, table, hr, .table-wrapper, .code-block-wrapper";

/** Duration of the opacity fade-in animation in milliseconds */
const FADE_DURATION_MS = 120;

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

interface RevealStep {
	entry: TextNodeEntry;
	stableText: string;
	fadeText: string;
}

const OBSERVER_OPTIONS: MutationObserverInit = {
	childList: true,
	characterData: true,
	subtree: true,
};

export interface TextRevealController {
	setStreaming(isStreaming: boolean): void;
	destroy(): void;
}

export function createTextReveal(container: HTMLElement): TextRevealController {
	const textNodes: TextNodeEntry[] = [];
	const hideableElements: HideableEntry[] = [];
	const originalTextByNode = new WeakMap<Text, string>();
	let animFrameId: number | null = null;
	let observer: MutationObserver | null = null;
	let fadeSpan: HTMLSpanElement | null = null;
	let fadeAnimation: Animation | null = null;
	let pendingDirtyTextNodes = new Set<Text>();
	let hasPendingReindex = false;
	let suppressImmediateReindex = false;
	let progress = createRevealProgress(0);

	function indexTextNodes(dirtyTextNodes?: ReadonlySet<Text>) {
		textNodes.length = 0;
		let totalChars = 0;
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
			acceptNode(node: Node) {
				const parent = (node as Text).parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				if (parent.closest(REVEAL_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
				if (parent.closest("[data-text-reveal-fade]")) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});

		let node: Text | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard walker loop
		while ((node = walker.nextNode() as Text | null)) {
			const preservedOriginal = dirtyTextNodes?.has(node)
				? undefined
				: originalTextByNode.get(node);
			const original = preservedOriginal !== undefined
				? preservedOriginal
				: node.textContent
					? node.textContent
					: "";
			originalTextByNode.set(node, original);
			textNodes.push({ node, original, startIndex: totalChars });
			totalChars += original.length;
		}

		progress = syncRevealProgress(progress, totalChars);
	}

	function indexHideableElements() {
		hideableElements.length = 0;

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
				for (const entry of textNodes) {
					if (block.compareDocumentPosition(entry.node) & Node.DOCUMENT_POSITION_FOLLOWING) {
						charPos = entry.startIndex;
						break;
					}
				}
				if (charPos === -1) charPos = progress.totalChars;
			}

			hideableElements.push({
				element: block as HTMLElement,
				charPosition: charPos,
				inclusive: true,
			});
		}

		const skips = container.querySelectorAll("[data-reveal-skip]");
		for (const skip of skips) {
			let charPos = 0;
			for (let index = textNodes.length - 1; index >= 0; index -= 1) {
				const entry = textNodes[index];
				if (skip.compareDocumentPosition(entry.node) & Node.DOCUMENT_POSITION_PRECEDING) {
					charPos = entry.startIndex + entry.original.length;
					break;
				}
			}

			hideableElements.push({
				element: skip as HTMLElement,
				charPosition: charPos,
				inclusive: false,
			});
		}
	}

	function cleanupFadeSpan() {
		if (fadeAnimation) {
			fadeAnimation.cancel();
			fadeAnimation = null;
		}
		if (fadeSpan?.parentNode) {
			fadeSpan.remove();
		}
		fadeSpan = null;
	}

	function applyElementVisibility() {
		for (const entry of hideableElements) {
			const shouldHide = entry.inclusive
				? progress.revealedChars <= entry.charPosition
				: progress.revealedChars < entry.charPosition;

			if (progress.isStreaming && shouldHide) {
				entry.element.style.display = "none";
			} else {
				const wasHidden = entry.element.style.display === "none";
				entry.element.style.removeProperty("display");
				if (wasHidden && progress.isStreaming) {
					entry.element.animate?.(
						[{ opacity: 0 }, { opacity: 1 }],
						{ duration: FADE_DURATION_MS, easing: "ease-out" },
					);
				}
			}
		}
	}

	function flushPendingMutations() {
		if (!hasPendingReindex) {
			return;
		}

		const dirtyTextNodes = pendingDirtyTextNodes.size > 0 ? new Set(pendingDirtyTextNodes) : undefined;
		pendingDirtyTextNodes = new Set<Text>();
		hasPendingReindex = false;

		cleanupFadeSpan();

		indexTextNodes(dirtyTextNodes);
		indexHideableElements();
		applyMask();
	}

	function applyMask() {
		observer?.disconnect();
		cleanupFadeSpan();

		const revealStep = buildRevealStep(progress, textNodes);

		for (const entry of textNodes) {
			if (!container.contains(entry.node)) continue;

			const end = entry.startIndex + entry.original.length;
			if (progress.revealedChars >= end) {
				if (entry.node.textContent !== entry.original) {
					entry.node.textContent = entry.original;
				}
				continue;
			}

			if (progress.revealedChars <= entry.startIndex) {
				if (entry.node.textContent !== "") {
					entry.node.textContent = "";
				}
				continue;
			}

			if (revealStep && revealStep.entry.node === entry.node) {
				const step = revealStep;
				entry.node.textContent = step.stableText;
				if (step.fadeText !== "") {
					fadeSpan = document.createElement("span");
					fadeSpan.dataset.textRevealFade = "true";
					fadeSpan.textContent = step.fadeText;
					entry.node.parentNode?.insertBefore(fadeSpan, entry.node.nextSibling);
					if (fadeSpan.animate) {
						fadeAnimation = fadeSpan.animate(
							[{ opacity: 0 }, { opacity: 1 }],
							{ duration: FADE_DURATION_MS, easing: "ease-out" },
						);
					} else {
						fadeAnimation = null;
					}
				}
				continue;
			}

			const visibleLen = progress.revealedChars - entry.startIndex;
			const visibleText = entry.original.slice(0, visibleLen);
			if (entry.node.textContent !== visibleText) {
				entry.node.textContent = visibleText;
			}
		}

		applyElementVisibility();
		progress = commitRenderedReveal(progress);
		observer?.observe(container, OBSERVER_OPTIONS);
	}

	function stopAnimation() {
		if (animFrameId !== null) {
			cancelAnimationFrame(animFrameId);
			animFrameId = null;
		}
		progress = clearRevealFrameTime(progress);
	}

	function scheduleAnimation() {
		if (animFrameId !== null) {
			return;
		}

		if (!hasPendingReindex && !hasPendingReveal(progress)) {
			return;
		}

		recordHotPathDiagnostic("text-reveal", "animation-scheduled");
		animFrameId = requestAnimationFrame((frameTime) => animate(frameTime));
	}

	function animate(frameTime: number) {
		animFrameId = null;
		recordHotPathDiagnostic("text-reveal", "animation-frame");
		flushPendingMutations();
		suppressImmediateReindex = false;

		if (!progress.isStreaming || progress.revealedChars >= progress.totalChars) {
			progress = clearRevealFrameTime(progress);
			return;
		}

		progress = advanceRevealProgress(progress, frameTime);
		applyMask();
		scheduleAnimation();
	}

	function onDomMutation(mutations: MutationRecord[]) {
		const dirtyTextNodes = collectDirtyTextNodes(mutations);
		const hasStructuralMutation = mutations.some((mutation) => mutation.type !== "characterData");
		recordHotPathDiagnostic("text-reveal", "mutation-batch", mutations.length);
		recordHotPathDiagnostic("text-reveal", "dirty-text-nodes", dirtyTextNodes.size);
		if (hasStructuralMutation) {
			recordHotPathDiagnostic("text-reveal", "mutation-structural");
		}

		if (!shouldReindexForMutations(mutations)) {
			recordHotPathDiagnostic("text-reveal", "mutation-skipped-reindex");
			scheduleAnimation();
			return;
		}

		if (!progress.isStreaming || hasStructuralMutation || !suppressImmediateReindex) {
			recordHotPathDiagnostic("text-reveal", "reindex-immediate");
			pendingDirtyTextNodes = new Set<Text>();
			hasPendingReindex = false;
			cleanupFadeSpan();
			indexTextNodes(dirtyTextNodes);
			indexHideableElements();
			applyMask();

			if (!progress.isStreaming) {
				stopAnimation();
				return;
			}

			suppressImmediateReindex = !hasStructuralMutation && hasPendingReveal(progress);
			scheduleAnimation();
			return;
		}

		for (const dirtyTextNode of dirtyTextNodes) {
			pendingDirtyTextNodes.add(dirtyTextNode);
		}
		recordHotPathDiagnostic("text-reveal", "reindex-deferred");
		hasPendingReindex = true;
		scheduleAnimation();
	}

	indexTextNodes();
	indexHideableElements();
	progress = updateStreamingState(progress, false);
	applyMask();

	observer = new MutationObserver(onDomMutation);
	observer.observe(container, OBSERVER_OPTIONS);

	return {
		setStreaming(nextIsStreaming: boolean) {
			if (progress.isStreaming === nextIsStreaming) {
				return;
			}

			recordHotPathDiagnostic(
				"text-reveal",
				nextIsStreaming ? "streaming-start" : "streaming-stop"
			);
			progress = updateStreamingState(progress, nextIsStreaming);
			if (!nextIsStreaming) {
				flushPendingMutations();
				suppressImmediateReindex = false;
				applyMask();
				stopAnimation();
				return;
			}

			scheduleAnimation();
		},
		destroy() {
			observer?.disconnect();
			observer = null;
			flushPendingMutations();
			suppressImmediateReindex = false;
			stopAnimation();
			cleanupFadeSpan();
			for (const entry of textNodes) {
				if (container.contains(entry.node) && entry.node.textContent !== entry.original) {
					entry.node.textContent = entry.original;
				}
			}
			for (const entry of hideableElements) {
				if (container.contains(entry.element)) {
					entry.element.style.removeProperty("display");
				}
			}
		},
	};
}

function buildRevealStep(
	progress: RevealProgress,
	textNodes: TextNodeEntry[],
): RevealStep | null {
	const remainingNewChars =
		progress.revealedChars > progress.renderedChars
			? progress.revealedChars - progress.renderedChars
			: 0;

	if (!progress.isStreaming || remainingNewChars === 0) {
		return null;
	}

	for (const entry of textNodes) {
		const visibleLen = progress.revealedChars - entry.startIndex;
		if (visibleLen <= 0) {
			continue;
		}

		const clampedVisibleLen = visibleLen > entry.original.length ? entry.original.length : visibleLen;
		const previouslyRenderedLen = progress.renderedChars - entry.startIndex;
		const clampedPreviouslyRenderedLen = previouslyRenderedLen < 0
			? 0
			: previouslyRenderedLen > clampedVisibleLen
				? clampedVisibleLen
				: previouslyRenderedLen;
		const availableNewChars = clampedVisibleLen - clampedPreviouslyRenderedLen;
		if (availableNewChars <= 0) {
			continue;
		}

		const fadeLen = remainingNewChars < availableNewChars ? remainingNewChars : availableNewChars;
		if (fadeLen <= 0) {
			break;
		}

		const stableLen = clampedVisibleLen - fadeLen;
		return {
			entry,
			stableText: entry.original.slice(0, stableLen),
			fadeText: entry.original.slice(stableLen, clampedVisibleLen),
		};
	}

	return null;
}

function collectDirtyTextNodes(mutations: MutationRecord[]): Set<Text> {
	const dirtyTextNodes = new Set<Text>();

	for (const mutation of mutations) {
		if (mutation.type !== "characterData") {
			continue;
		}

		if (!(mutation.target instanceof Text)) {
			continue;
		}

		const parent = mutation.target.parentElement;
		if (parent?.closest("[data-text-reveal-fade]")) {
			continue;
		}

		dirtyTextNodes.add(mutation.target);
	}

	return dirtyTextNodes;
}

function shouldReindexForMutations(mutations: MutationRecord[]): boolean {
	for (const mutation of mutations) {
		if (mutation.type === "characterData") {
			const parent = mutation.target.parentElement;
			if (parent?.closest("[data-text-reveal-fade]")) {
				continue;
			}
			return true;
		}

		for (const node of mutation.addedNodes) {
			if (nodeAffectsReveal(node)) {
				return true;
			}
		}

		for (const node of mutation.removedNodes) {
			if (nodeAffectsReveal(node)) {
				return true;
			}
		}
	}

	return false;
}

function nodeAffectsReveal(node: Node): boolean {
	if (node.nodeType === Node.TEXT_NODE) {
		return true;
	}

	if (!(node instanceof Element)) {
		return false;
	}

	if (node.matches("[data-text-reveal-fade]")) {
		return false;
	}

	if (node.matches(REVEAL_SKIP_SELECTOR) || node.matches(HIDEABLE_BLOCK_SELECTOR)) {
		return true;
	}

	if (node.querySelector(REVEAL_SKIP_SELECTOR) || node.querySelector(HIDEABLE_BLOCK_SELECTOR)) {
		return true;
	}

	return Boolean(node.textContent);
}
