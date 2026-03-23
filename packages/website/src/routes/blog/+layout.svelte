<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	// Note: Markdown renderer is initialized globally by @acepe/ui
	// No initialization needed here - MarkdownDisplay uses singleton pattern
</script>

{@render children()}
