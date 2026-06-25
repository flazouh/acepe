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
		? "mb-2 flex items-start justify-between gap-3"
		: "mb-3 flex items-start justify-between gap-3"}
>
	<div class="min-w-0">
		<h3
			class={variant === "subsection"
				? "text-[11px] font-semibold text-foreground"
				: "text-xs font-semibold text-foreground"}
		>
			{title}
		</h3>
		{#if description}
			<p class="mt-0.5 text-[11px] leading-snug text-muted-foreground/70">
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
