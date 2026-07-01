<script lang="ts">
import { RoundedIcon, type RoundedIconName } from "@acepe/ui/icons";
import { Sparkle } from "phosphor-svelte";
import { cn } from "$lib/utils.js";

interface Props {
	/** Phosphor icon component. Defaults to Sparkle. */
	icon?: typeof Sparkle;
	/** Rounded icon name from @acepe/ui/icons. */
	roundedIcon?: RoundedIconName;
	/** Short headline — e.g., "MCP servers coming soon". */
	headline: string;
	/** One-sentence description of what will live here. */
	description: string;
	class?: string;
}

let { icon, roundedIcon, headline, description, class: className }: Props = $props();

const IconComponent = $derived(icon ?? Sparkle);
</script>

<div
	class={cn(
		"flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
		className
	)}
>
	{#if roundedIcon}
		<RoundedIcon name={roundedIcon} class="size-4 text-muted-foreground/50" />
	{:else}
		<IconComponent class="size-4 text-muted-foreground/50" weight="regular" />
	{/if}
	<div class="flex max-w-[320px] flex-col gap-0.5">
		<p class="text-xs font-medium text-foreground/80">{headline}</p>
		<p class="text-[11px] leading-snug text-muted-foreground/60">{description}</p>
	</div>
	<span class="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/50">
		Coming soon
	</span>
</div>
