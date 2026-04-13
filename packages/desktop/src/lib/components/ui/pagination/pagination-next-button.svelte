<script lang="ts">
import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
import { Pagination as PaginationPrimitive } from "bits-ui";
import { buttonVariants } from "$lib/components/ui/button/index.js";
import * as m from "$lib/messages.js";
import { cn } from "$lib/utils.js";

let {
	ref = $bindable(null),
	class: className,
	children,
	...restProps
}: PaginationPrimitive.NextButtonProps = $props();
</script>

{#snippet Fallback()}
	<span>{m.pagination_next()}</span>
	<ChevronRightIcon class="size-4" />
{/snippet}

<PaginationPrimitive.NextButton
	bind:ref
	aria-label={m.aria_next_page()}
	class={cn(
		buttonVariants({
			size: "default",
			variant: "ghost",
			class: "gap-1 px-2.5 sm:pe-2.5",
		}),
		className
	)}
	children={children || Fallback}
	{...restProps}
/>
