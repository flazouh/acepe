<script lang="ts">
import { onDestroy } from "svelte";
import { cn, type WithElementRef } from "$lib/utils.js";

import {
	type CarouselAPI,
	type CarouselProps,
	type EmblaContext,
	setEmblaContext,
} from "./context.js";

let {
	ref = $bindable(null),
	opts = {},
	plugins = [],
	setApi = () => {},
	orientation = "horizontal",
	class: className,
	children,
	...restProps
}: WithElementRef<CarouselProps> = $props();

let carouselState = $state<EmblaContext>({
	api: undefined,
	scrollPrev,
	scrollNext,
	orientation: "horizontal",
	canScrollNext: false,
	canScrollPrev: false,
	handleKeyDown,
	options: {},
	plugins: [],
	onInit,
	scrollSnaps: [],
	selectedIndex: 0,
	scrollTo,
});

// Update carousel state when props change - uses $effect
$effect(() => {
	carouselState.orientation = orientation;
	carouselState.options = opts;
	carouselState.plugins = plugins;
});

setEmblaContext(carouselState);

function scrollPrev() {
	carouselState.api?.scrollPrev();
}

function scrollNext() {
	carouselState.api?.scrollNext();
}

function scrollTo(index: number, jump?: boolean) {
	carouselState.api?.scrollTo(index, jump);
}

function onSelect() {
	if (!carouselState.api) return;
	carouselState.selectedIndex = carouselState.api.selectedScrollSnap();
	carouselState.canScrollNext = carouselState.api.canScrollNext();
	carouselState.canScrollPrev = carouselState.api.canScrollPrev();
}

function handleKeyDown(e: KeyboardEvent) {
	if (e.key === "ArrowLeft") {
		e.preventDefault();
		scrollPrev();
	} else if (e.key === "ArrowRight") {
		e.preventDefault();
		scrollNext();
	}
}

function onInit(event: CustomEvent<CarouselAPI>) {
	carouselState.api = event.detail;
	setApi(carouselState.api);

	carouselState.scrollSnaps = carouselState.api.scrollSnapList();
	carouselState.api.on("select", onSelect);
	onSelect();
}

// Cleanup on destroy
onDestroy(() => {
	carouselState.api?.off("select", onSelect);
});
</script>

<div
	bind:this={ref}
	data-slot="carousel"
	class={cn("relative", className)}
	role="region"
	aria-roledescription="carousel"
	{...restProps}
>
	{@render children?.()}
</div>
