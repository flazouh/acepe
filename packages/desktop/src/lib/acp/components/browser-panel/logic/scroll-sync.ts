function canBecomeScrollable(element: HTMLElement): boolean {
	const style = window.getComputedStyle(element);
	const overflowX = style.overflowX;
	const overflowY = style.overflowY;
	const canScrollX = overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay";
	const canScrollY = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";

	return canScrollX || canScrollY;
}

export function getScrollEventTargets(node: HTMLElement): EventTarget[] {
	const targets: EventTarget[] = [];
	let currentParent: HTMLElement | null = node.parentElement;

	while (currentParent) {
		if (canBecomeScrollable(currentParent)) {
			targets.push(currentParent);
		}
		currentParent = currentParent.parentElement;
	}

	targets.push(window);

	return targets;
}

export function observeScrollParents(node: HTMLElement, onScroll: () => void): () => void {
	const targets = getScrollEventTargets(node);

	for (const target of targets) {
		target.addEventListener("scroll", onScroll, { passive: true });
	}

	return () => {
		for (const target of targets) {
			target.removeEventListener("scroll", onScroll);
		}
	};
}
