<script lang="ts">
import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
import { Pagination as PaginationPrimitive } from "bits-ui";
import { buttonVariants } from "$lib/components/ui/button/index.js";
import * as m from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: PaginationPrimitive.PrevButtonProps = $props();
</script>

{#snippet Fallback()}
	<ChevronLeftIcon class="size-4" />
	<span>{m.pagination_previous()}</span>
{/snippet}

<PaginationPrimitive.PrevButton
	bind:ref
	aria-label={m.aria_previous_page()}
	class={cn(
		buttonVariants({
			size: "default",
			variant: "ghost",
			class: "gap-1 px-2.5 sm:ps-2.5",
		}),
		className
	)}
	children={children || Fallback}
	{...restProps}
/>
