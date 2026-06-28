export type ProximityItemRect = {
	top: number;
	height: number;
	left: number;
	width: number;
};

export type ProximityHoverAxis = "x" | "y";

type ProximityHoverOptions = {
	axis?: ProximityHoverAxis;
};

/**
 * Cursor-driven nearest-item tracking for menu rows (Fluid Functionalism pattern).
 * Uses offsetTop/offsetLeft so measurements stay stable under parent transforms.
 */
export class ProximityHoverController {
	#container: () => HTMLElement | null | undefined;
	#axis: ProximityHoverAxis;
	#items = new Map<number, HTMLElement>();
	#itemRects: ProximityItemRect[] = [];
	#rafId: number | null = null;
	#remeasureRafId: number | null = null;
	#activeIndex: number | null = null;
	#sessionCounter = 0;

	constructor(
		container: () => HTMLElement | null | undefined,
		options: ProximityHoverOptions = {},
	) {
		this.#container = container;
		this.#axis = options.axis ?? "y";
	}

	get activeIndex(): number | null {
		return this.#activeIndex;
	}

	get sessionCounter(): number {
		return this.#sessionCounter;
	}

	get itemRects(): readonly ProximityItemRect[] {
		return this.#itemRects;
	}

	registerItem(index: number, element: HTMLElement | null): void {
		if (element) {
			this.#items.set(index, element);
		} else {
			this.#items.delete(index);
		}
		this.scheduleMeasure();
	}

	scheduleMeasure(): void {
		if (this.#remeasureRafId !== null) {
			cancelAnimationFrame(this.#remeasureRafId);
		}
		this.#remeasureRafId = requestAnimationFrame(() => {
			this.#remeasureRafId = null;
			this.measureItems();
		});
	}

	measureItems(): void {
		const container = this.#container();
		if (!container) {
			return;
		}

		const rects: ProximityItemRect[] = [];
		this.#items.forEach((element, index) => {
			rects[index] = {
				top: element.offsetTop,
				height: element.offsetHeight,
				left: element.offsetLeft,
				width: element.offsetWidth,
			};
		});
		this.#itemRects = rects;
	}

	getActiveRect(): ProximityItemRect | null {
		if (this.#activeIndex === null) {
			return null;
		}
		return this.#itemRects[this.#activeIndex] ?? null;
	}

	getRectForElement(element: HTMLElement | null): ProximityItemRect | null {
		if (!element) {
			return null;
		}
		for (const [index, item] of this.#items.entries()) {
			if (item === element) {
				return this.#itemRects[index] ?? null;
			}
		}
		return null;
	}

	findCheckedIndex(): number | null {
		for (const [index, element] of this.#items.entries()) {
			if (
				element.getAttribute("data-state") === "checked" ||
				element.getAttribute("aria-checked") === "true"
			) {
				return index;
			}
		}
		return null;
	}

	handleMouseEnter(): void {
		this.#sessionCounter += 1;
	}

	handleMouseLeave(): void {
		if (this.#rafId !== null) {
			cancelAnimationFrame(this.#rafId);
			this.#rafId = null;
		}
		this.#activeIndex = null;
		this.clearProximityAttributes();
	}

	handleMouseMove(event: MouseEvent): void {
		if (this.#rafId !== null) {
			cancelAnimationFrame(this.#rafId);
		}

		this.#rafId = requestAnimationFrame(() => {
			this.#rafId = null;
			this.#activeIndex = this.resolveActiveIndex(event.clientX, event.clientY);
			this.syncProximityAttributes();
		});
	}

	destroy(): void {
		if (this.#rafId !== null) {
			cancelAnimationFrame(this.#rafId);
		}
		if (this.#remeasureRafId !== null) {
			cancelAnimationFrame(this.#remeasureRafId);
		}
		this.clearProximityAttributes();
	}

	private resolveActiveIndex(mouseX: number, mouseY: number): number | null {
		const container = this.#container();
		if (!container) {
			return null;
		}

		const containerRect = container.getBoundingClientRect();
		const mousePos = this.#axis === "x" ? mouseX : mouseY;
		const scrollOffset = this.#axis === "x" ? container.scrollLeft : container.scrollTop;
		const borderOffset = this.#axis === "x" ? container.clientLeft : container.clientTop;
		const containerEdge = this.#axis === "x" ? containerRect.left : containerRect.top;
		const layoutSize = this.#axis === "x" ? container.offsetWidth : container.offsetHeight;
		const visualSize = this.#axis === "x" ? containerRect.width : containerRect.height;
		const scale = layoutSize > 0 ? visualSize / layoutSize : 1;

		let closestIndex: number | null = null;
		let closestDistance = Infinity;
		let containingIndex: number | null = null;

		for (let index = 0; index < this.#itemRects.length; index += 1) {
			const rect = this.#itemRects[index];
			if (!rect) {
				continue;
			}

			const contentPos = this.#axis === "x" ? rect.left : rect.top;
			const itemStart = containerEdge + (borderOffset + contentPos - scrollOffset) * scale;
			const itemSize = (this.#axis === "x" ? rect.width : rect.height) * scale;
			const itemEnd = itemStart + itemSize;

			if (mousePos >= itemStart && mousePos <= itemEnd) {
				containingIndex = index;
			}

			const itemCenter = itemStart + itemSize / 2;
			const distance = Math.abs(mousePos - itemCenter);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestIndex = index;
			}
		}

		return containingIndex ?? closestIndex;
	}

	private syncProximityAttributes(): void {
		this.#items.forEach((element, index) => {
			if (index === this.#activeIndex) {
				element.setAttribute("data-proximity-active", "");
			} else {
				element.removeAttribute("data-proximity-active");
			}
		});
	}

	private clearProximityAttributes(): void {
		this.#items.forEach((element) => {
			element.removeAttribute("data-proximity-active");
		});
	}
}
