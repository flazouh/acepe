<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		class?: string;
		withDivider?: boolean;
	}

	let { children, class: className = "", withDivider = true }: Props = $props();
</script>

<div class="h-7 flex items-center justify-center shrink-0 w-7 {withDivider ? 'border-r border-border/50' : ''} {className}">
	{@render children?.()}
</div>
