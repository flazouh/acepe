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
		? "mb-1.5 flex items-start justify-between gap-3"
		: "mb-3 flex items-start justify-between gap-3"}
>
	<div class="min-w-0">
		<h3
			class={variant === "subsection"
				? "text-[13px] font-semibold text-foreground"
				: "text-sm font-semibold text-foreground"}
		>
			{title}
		</h3>
		{#if description}
			<p class="mt-0.5 text-[12px] leading-snug text-muted-foreground">
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
