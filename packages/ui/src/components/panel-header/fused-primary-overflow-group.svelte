<!--
  FusedPrimaryOverflowGroup — Primary control + three-dot overflow in one rounded shell.

  Used by setup-bar worktree toggle and composer voice mic + model menu.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { ButtonGroup } from "../button-group/index.js";
	import { buttonVariants } from "../button/variants.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		class?: string;
		leading?: Snippet;
		primary: Snippet;
		overflow: Snippet;
	}

	let { class: className, leading, primary, overflow }: Props = $props();

	const leadingSegmentClass = cn(
		buttonVariants({ variant: "secondary", size: "sm" }),
		"pointer-events-none rounded-none rounded-l-md shadow-none"
	);
</script>

<ButtonGroup class={className}>
	{#if leading}
		<div data-slot="button" class={cn(leadingSegmentClass)}>
			{@render leading()}
		</div>
	{/if}
	{@render primary()}
	{@render overflow()}
</ButtonGroup>
