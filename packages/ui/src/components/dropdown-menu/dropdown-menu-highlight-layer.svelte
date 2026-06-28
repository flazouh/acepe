<script lang="ts">
	import type { Snippet } from "svelte";

	import {
		setDropdownMenuHighlightContext,
		type DropdownMenuHighlightContext,
	} from "./dropdown-menu-highlight-context.js";
	import { dropdownMenuItemRadiusClass } from "./dropdown-menu-item.classes.js";

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	let containerRef: HTMLDivElement | undefined = $state();
	let highlightRef: HTMLDivElement | undefined = $state();
	let highlightTarget: HTMLElement | null = $state(null);

	function updateHighlight(element: HTMLElement | null): void {
		highlightTarget = element;
	}

	function clearHighlight(): void {
		highlightTarget = null;
	}

	function applyHighlightPosition(): void {
		if (!highlightRef || !containerRef) return;
		if (!highlightTarget) {
			highlightRef.style.opacity = "0";
			return;
		}
		const containerRect = containerRef.getBoundingClientRect();
		const targetRect = highlightTarget.getBoundingClientRect();
		const top = targetRect.top - containerRect.top + containerRef.scrollTop;
		const left = targetRect.left - containerRect.left + containerRef.scrollLeft;
		highlightRef.style.top = `${top}px`;
		highlightRef.style.left = `${left}px`;
		highlightRef.style.width = `${targetRect.width}px`;
		highlightRef.style.height = `${targetRect.height}px`;
		highlightRef.style.opacity = "1";
	}

	$effect(() => {
		highlightTarget;
		if (highlightRef && containerRef) {
			applyHighlightPosition();
		}
	});

	$effect(() => {
		if (!containerRef || !highlightTarget) return;
		const el = containerRef;
		const onScroll = (): void => {
			if (highlightTarget) applyHighlightPosition();
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	});

	const highlightContext: DropdownMenuHighlightContext = {
		updateHighlight,
		clearHighlight,
	};
	setDropdownMenuHighlightContext(highlightContext);
</script>

<div class="relative flex flex-col gap-1" bind:this={containerRef}>
	<div
		bind:this={highlightRef}
		class="pointer-events-none absolute {dropdownMenuItemRadiusClass} bg-accent opacity-0 transition-[top,left,width,height,opacity] duration-75 ease-out"
		aria-hidden="true"
	></div>
	{@render children()}
</div>
