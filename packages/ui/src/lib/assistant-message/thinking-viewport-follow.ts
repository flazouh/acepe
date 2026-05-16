export function scrollTailToVisibleEnd(scrollContainer: HTMLDivElement): void {
	const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
	if (maxScrollTop <= 0) {
		return;
	}

	scrollContainer.scrollTop = maxScrollTop;
}

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
