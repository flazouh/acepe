<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		class?: string;
		withDivider?: boolean;
	}

	let { children, class: className = "", withDivider = true }: Props = $props();
</script>

<div class="flex h-7 items-center gap-0.5 px-0.5 {withDivider ? 'border-l border-border/50' : ''} {className}">
	{@render children?.()}
</div>
