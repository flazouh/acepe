<script lang="ts">
import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
import { Pagination as PaginationPrimitive } from "bits-ui";
import { buttonVariants } from "$lib/components/ui/button/index.js";
import * as m from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	...restProps
}: PaginationPrimitive.PrevButtonProps = $props();
</script>

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
	{...restProps}
>
	<ChevronLeftIcon />
	<span class="hidden sm:block">{m.pagination_previous()}</span>
</PaginationPrimitive.PrevButton>
