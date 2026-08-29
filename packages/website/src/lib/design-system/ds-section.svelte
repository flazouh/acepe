<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	id: string;
	title: string;
	description: string;
	children: Snippet;
}

let { id, title, description, children }: Props = $props();
</script>

<section {id} class="scroll-mt-24">
	<div class="mb-5 max-w-2xl">
		<h2 class="text-lg font-medium tracking-tight text-foreground">{title}</h2>
		<p class="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
	</div>
	{@render children()}
</section>
