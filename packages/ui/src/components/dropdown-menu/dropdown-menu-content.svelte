<script lang="ts">
	import type { ComponentProps, Snippet } from "svelte";

	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { type WithoutChildrenOrChild, cn } from "../../lib/utils";

	import DropdownMenuPortal from "./dropdown-menu-portal.svelte";
	import {
		setDropdownMenuHighlightContext,
		type DropdownMenuHighlightContext,
	} from "./dropdown-menu-highlight-context";

	let {
		ref = $bindable(null),
		sideOffset = 4,
		portalProps,
		class: className,
		children,
		...restProps
	}: DropdownMenuPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
		children?: Snippet;
	} = $props();

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
		const top =
			targetRect.top - containerRect.top + containerRef.scrollTop;
		const left =
			targetRect.left - containerRect.left + containerRef.scrollLeft;
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

<DropdownMenuPortal {...portalProps}>
	<DropdownMenuPrimitive.Content
		bind:ref
		data-slot="dropdown-menu-content"
		{sideOffset}
		class={cn(
			"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
			"data-[side=bottom]:slide-in-from-top-2",
			"data-[side=left]:slide-in-from-right-2",
			"data-[side=right]:slide-in-from-left-2",
			"data-[side=top]:slide-in-from-bottom-2",
			"z-[var(--overlay-z)] max-h-(--bits-dropdown-menu-content-available-height)",
			"min-w-[8rem] overflow-y-auto overflow-x-hidden p-0",
			"bg-popover text-popover-foreground shadow-md",
			"data-[state=closed]:animate-out data-[state=open]:animate-in",
			"border border-border",
			"rounded-lg",
			className
		)}
		{...restProps}
	>
		<div class="relative flex flex-col" bind:this={containerRef}>
			<div
				bind:this={highlightRef}
				class="pointer-events-none absolute bg-muted opacity-0 transition-[top,left,width,height,opacity] duration-75 ease-out"
				aria-hidden="true"
			></div>
			{#if children}
				{@render children()}
			{/if}
		</div>
	</DropdownMenuPrimitive.Content>
</DropdownMenuPortal>
