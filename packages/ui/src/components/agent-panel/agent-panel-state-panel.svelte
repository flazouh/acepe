<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		class?: string;
		contentClass?: string;
		centerContent?: boolean;
	}

	let {
		children,
		class: className = "",
		contentClass = "",
		centerContent = false,
	}: Props = $props();
</script>

<div
	class="h-full min-h-0 flex flex-col {centerContent ? 'items-center justify-center' : ''} {className}"
>
	<div class="w-full {contentClass}">
		{@render children()}
	</div>
</div>
