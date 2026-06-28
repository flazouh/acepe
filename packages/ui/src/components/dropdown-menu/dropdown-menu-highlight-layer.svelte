<script lang="ts">
	import type { Snippet } from "svelte";

	import { ProximityHoverController } from "../../lib/proximity-hover.js";
	import {
		applyDropdownMenuLayerStyle,
		dropdownMenuActiveLayerClass,
		dropdownMenuFocusRingLayerClass,
		dropdownMenuHighlightContainerClass,
		dropdownMenuHoverLayerClass,
	} from "./dropdown-menu-layer.classes.js";
	import {
		setDropdownMenuHighlightContext,
		type DropdownMenuHighlightContext,
	} from "./dropdown-menu-highlight-context.js";

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	let containerRef: HTMLDivElement | undefined = $state();
	let hoverLayerRef: HTMLDivElement | undefined = $state();
	let activeLayerRef: HTMLDivElement | undefined = $state();
	let focusLayerRef: HTMLDivElement | undefined = $state();
	let focusedElement: HTMLElement | null = $state(null);
	let nextItemIndex = 0;

	const proximity = new ProximityHoverController(() => containerRef);

	function attachItem(element: HTMLElement): () => void {
		const index = nextItemIndex;
		nextItemIndex += 1;
		proximity.registerItem(index, element);
		return () => {
			proximity.registerItem(index, null);
			if (focusedElement === element) {
				focusedElement = null;
			}
		};
	}

	const highlightContext: DropdownMenuHighlightContext = {
		attachItem,
	};
	setDropdownMenuHighlightContext(highlightContext);

	function syncLayers(): void {
		const activeRect = proximity.getActiveRect();
		const checkedIndex = proximity.findCheckedIndex();
		const checkedRect =
			checkedIndex !== null ? proximity.itemRects[checkedIndex] ?? null : null;
		const focusRect = proximity.getRectForElement(focusedElement);
		const isHoveringOther =
			proximity.activeIndex !== null &&
			checkedIndex !== null &&
			proximity.activeIndex !== checkedIndex;

		if (hoverLayerRef) {
			applyDropdownMenuLayerStyle(hoverLayerRef, activeRect);
		}

		if (activeLayerRef) {
			applyDropdownMenuLayerStyle(activeLayerRef, checkedRect, {
				opacity: isHoveringOther ? 0.8 : checkedRect ? 1 : 0,
			});
		}

		if (focusLayerRef) {
			applyDropdownMenuLayerStyle(focusLayerRef, focusRect, { inset: 2 });
		}
	}

	function handleMouseEnter(): void {
		proximity.handleMouseEnter();
	}

	function handleMouseMove(event: MouseEvent): void {
		proximity.handleMouseMove(event);
		syncLayers();
	}

	function handleMouseLeave(): void {
		proximity.handleMouseLeave();
		syncLayers();
	}

	function handleFocusIn(event: FocusEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		if (!target.matches("[data-slot^='dropdown-menu-']")) {
			return;
		}
		focusedElement = target.matches(":focus-visible") ? target : null;
		syncLayers();
	}

	function handleFocusOut(event: FocusEvent): void {
		const related = event.relatedTarget;
		if (related instanceof Node && containerRef?.contains(related)) {
			return;
		}
		focusedElement = null;
		syncLayers();
	}

	$effect(() => {
		containerRef;
		hoverLayerRef;
		activeLayerRef;
		focusLayerRef;
		focusedElement;
		syncLayers();
	});

	$effect(() => {
		if (!containerRef) {
			return;
		}
		const onScroll = (): void => {
			syncLayers();
		};
		containerRef.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			containerRef.removeEventListener("scroll", onScroll);
		};
	});

	$effect(() => {
		if (!containerRef) {
			return;
		}
		const observer = new MutationObserver(() => {
			proximity.scheduleMeasure();
			syncLayers();
		});
		observer.observe(containerRef, {
			subtree: true,
			attributes: true,
			attributeFilter: ["data-state", "aria-checked"],
		});
		return () => {
			observer.disconnect();
		};
	});

	$effect(() => {
		return () => {
			proximity.destroy();
		};
	});
</script>

<div
	class={dropdownMenuHighlightContainerClass}
	bind:this={containerRef}
	onmouseenter={handleMouseEnter}
	onmousemove={handleMouseMove}
	onmouseleave={handleMouseLeave}
	onfocusin={handleFocusIn}
	onfocusout={handleFocusOut}
>
	<div bind:this={hoverLayerRef} class={dropdownMenuHoverLayerClass} aria-hidden="true"></div>
	<div bind:this={activeLayerRef} class={dropdownMenuActiveLayerClass} aria-hidden="true"></div>
	<div bind:this={focusLayerRef} class={dropdownMenuFocusRingLayerClass} aria-hidden="true"></div>
	{@render children()}
</div>
