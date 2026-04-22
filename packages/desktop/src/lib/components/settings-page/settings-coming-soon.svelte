<script lang="ts">
import { Sparkle } from "phosphor-svelte";
import { cn } from "$lib/utils.js";

interface Props {
	/** Phosphor icon component. Defaults to Sparkle. */
	icon?: typeof Sparkle;
	/** Short headline — e.g., "MCP servers coming soon". */
	headline: string;
	/** One-sentence description of what will live here. */
	description: string;
	class?: string;
}

let { icon, headline, description, class: className }: Props = $props();

const IconComponent = $derived(icon ?? Sparkle);
</script>

<div
	class={cn(
		"flex flex-col items-center justify-center gap-3 px-8 py-14 text-center",
		className
	)}
>
	<div
		class="flex size-10 items-center justify-center rounded-full border border-border/50 bg-background text-muted-foreground/60"
	>
		<IconComponent class="size-4" weight="regular" />
	</div>
	<div class="flex flex-col gap-1 max-w-[360px]">
		<p class="text-[13px] font-medium text-foreground/80">{headline}</p>
		<p class="text-[12px] leading-relaxed text-muted-foreground/60">{description}</p>
	</div>
	<span
		class="mt-1 rounded-full border border-border/50 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
	>
		Coming soon
	</span>
</div>
