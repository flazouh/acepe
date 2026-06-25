<!--
  FusedPrimaryOverflowGroup — Primary control + three-dot overflow in one rounded shell.

  Used by setup-bar worktree toggle and composer voice mic + model menu.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { ButtonGroup } from "../button-group/index.js";
	import { cn } from "../../lib/utils.js";
	import {
		FUSED_CONTROL_CHIP_GROUP_CLASS,
		FUSED_CONTROL_LEADING_SEGMENT_CLASS,
	} from "./project-card-action-button-class.js";

	interface Props {
		class?: string;
		leading?: Snippet;
		primary: Snippet;
		overflow: Snippet;
	}

	let { class: className, leading, primary, overflow }: Props = $props();
</script>

<ButtonGroup class={cn(FUSED_CONTROL_CHIP_GROUP_CLASS, className)}>
	{#if leading}
		<div data-slot="button" class={FUSED_CONTROL_LEADING_SEGMENT_CLASS}>
			{@render leading()}
		</div>
	{/if}
	{@render primary()}
	{@render overflow()}
</ButtonGroup>
