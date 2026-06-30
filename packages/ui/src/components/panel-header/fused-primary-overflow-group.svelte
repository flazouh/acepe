<!--
  FusedPrimaryOverflowGroup — Primary control + three-dot overflow in one rounded shell.

  Used by setup-bar worktree toggle and composer voice mic + model menu.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { ButtonGroup } from "../button-group/index.js";
	import { COMPOSER_FUSED_GROUP_LEADING_SEGMENT_CLASS } from "../agent-panel/agent-input-chip-classes.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		class?: string;
		leading?: Snippet;
		primary: Snippet;
		overflow: Snippet;
	}

	let { class: className, leading, primary, overflow }: Props = $props();
</script>

<ButtonGroup class={className}>
	{#if leading}
		<div data-slot="button" class={COMPOSER_FUSED_GROUP_LEADING_SEGMENT_CLASS}>
			{@render leading()}
		</div>
	{/if}
	{@render primary()}
	{@render overflow()}
</ButtonGroup>
