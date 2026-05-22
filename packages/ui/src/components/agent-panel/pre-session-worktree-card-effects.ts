type MeasurableElement = Pick<HTMLElement, "getBoundingClientRect">;

export function measurePreSessionWorktreeHeaderWidth(
	header: MeasurableElement | null
): number | null {
	if (!header) return null;

	const nextWidth = Math.ceil(header.getBoundingClientRect().width);
	return nextWidth > 0 ? nextWidth : null;
}

export function watchPreSessionWorktreeHeaderWidth(input: {
	header: HTMLElement | null;
	isExpanded: boolean;
	onWidth: (width: number) => void;
	resizeObserver?: typeof ResizeObserver;
}): () => void {
	const { header, isExpanded, onWidth } = input;
	if (!header) return () => {};

	const measure = () => {
		if (isExpanded) return;

		const nextWidth = measurePreSessionWorktreeHeaderWidth(header);
		if (nextWidth !== null) {
			onWidth(nextWidth);
		}
	};

	measure();

	const ResizeObserverClass = input.resizeObserver ?? globalThis.ResizeObserver;
	if (typeof ResizeObserverClass !== "function") return () => {};

	const observer = new ResizeObserverClass(measure);
	observer.observe(header);

	return () => observer.disconnect();
}
