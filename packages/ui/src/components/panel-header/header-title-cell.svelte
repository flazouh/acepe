<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		class?: string;
		hoverable?: boolean;
		compactPadding?: boolean;
	}

	let { children, class: className = "", hoverable = false, compactPadding = false }: Props = $props();
</script>

<div
	class="h-7 flex items-center flex-1 min-w-0 font-mono {compactPadding ? 'pl-1.5 pr-2' : 'pl-2.5 pr-2'} {hoverable
		? 'hover:bg-accent/50 transition-colors'
		: ''} {className}"
>
	{@render children?.()}
</div>
