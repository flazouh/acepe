<script lang="ts">
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import ComposerFilterDropdownBody from "./composer-filter-dropdown-body.svelte";
	import { composerFilterDropdownContentClass } from "./composer-filter-dropdown-menu.classes.js";

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		trigger: Snippet<[{ props: Record<string, unknown> }]>;
		searchQuery?: string;
		searchPlaceholder?: string;
		searchAriaLabel?: string;
		inputRef?: HTMLInputElement | null;
		showFilter?: boolean;
		side?: "top" | "right" | "bottom" | "left";
		align?: "start" | "center" | "end";
		sideOffset?: number;
		contentClass?: string;
		children: Snippet;
	}

	let {
		open = $bindable(false),
		onOpenChange,
		trigger,
		searchQuery = $bindable(""),
		searchPlaceholder = "",
		searchAriaLabel = searchPlaceholder,
		inputRef = $bindable(null),
		showFilter = true,
		side = "top",
		align = "start",
		sideOffset = 8,
		contentClass = "",
		children,
	}: Props = $props();

	const resolvedContentClass = $derived(
		cn(composerFilterDropdownContentClass, contentClass)
	);
</script>

<DropdownMenu.Root bind:open {onOpenChange}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{@render trigger({ props })}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content {side} {align} {sideOffset} class={resolvedContentClass}>
		<ComposerFilterDropdownBody
			bind:searchQuery
			{searchPlaceholder}
			searchAriaLabel={searchAriaLabel}
			bind:inputRef={inputRef}
			{showFilter}
		>
			{@render children()}
		</ComposerFilterDropdownBody>
	</DropdownMenu.Content>
</DropdownMenu.Root>
