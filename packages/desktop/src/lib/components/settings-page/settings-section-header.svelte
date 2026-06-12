<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	title: string;
	description?: string;
	/** Subsection titles inside a page that already has a top-level header. */
	variant?: "default" | "subsection";
	actions?: Snippet;
}

let { title, description, variant = "default", actions }: Props = $props();
</script>

<div
	class={variant === "subsection"
		? "mb-4 flex items-start justify-between gap-4"
		: "mb-5 flex items-start justify-between gap-4"}
>
	<div class="min-w-0">
		<h3
			class={variant === "subsection"
				? "text-[12px] font-semibold text-foreground"
				: "text-[13px] font-semibold text-foreground"}
		>
			{title}
		</h3>
		{#if description}
			<p class="mt-0.5 text-[12px] text-muted-foreground">
				{description}
			</p>
		{/if}
	</div>
	{#if actions}
		<div class="shrink-0">
			{@render actions()}
		</div>
	{/if}
</div>
