<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		class?: string;
		withDivider?: boolean;
	}

	let { children, class: className = "", withDivider = true }: Props = $props();
</script>

<div class="h-7 flex items-stretch {withDivider ? 'border-l border-border/50' : ''} {className}">
	{@render children?.()}
</div>
