/**
 * Tail-follow for the inline thinking scrollport.
 *
 * Scroll strategy: align the end of the last markdown block with the bottom of the
 * scroll container via `scrollIntoView({ block: "end" })` when possible; otherwise
 * `scrollTop = max`. Callers must ensure the scroll container is the correct overflow
 * box (see plan: nested thread vs thinking scroller).
 */

const MARKDOWN_BLOCK_SELECTOR = ".markdown-content > *";

export function resolveTailTarget(contentRoot: HTMLElement): HTMLElement | null {
	const blocks = contentRoot.querySelectorAll(MARKDOWN_BLOCK_SELECTOR);
	const lastBlock = blocks[blocks.length - 1];
	if (lastBlock instanceof HTMLElement) {
		return lastBlock;
	}

	const fallback = contentRoot.lastElementChild;
	if (fallback instanceof HTMLElement) {
		return fallback;
	}

	return null;
}

export function scrollTailToVisibleEnd(
	scrollContainer: HTMLDivElement,
	contentRoot: HTMLElement | undefined
): void {
	const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
	if (maxScrollTop <= 0) {
		return;
	}

	if (contentRoot) {
		const target = resolveTailTarget(contentRoot);
		if (target !== null) {
			target.scrollIntoView({
				block: "end",
				behavior: "instant",
				inline: "nearest",
			});
			return;
		}
	}

	scrollContainer.scrollTop = maxScrollTop;
}

/**
 * RAF-coalesced runner for resize/stream follow (at most one pending frame).
 */
export function createRafDedupeScheduler(run: () => void): {
	schedule: () => void;
	cancel: () => void;
} {
	let rafId: number | null = null;

	return {
		schedule(): void {
			if (rafId !== null) {
				return;
			}
			rafId = requestAnimationFrame(() => {
				rafId = null;
				run();
			});
		},
		cancel(): void {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
		},
	};
}
