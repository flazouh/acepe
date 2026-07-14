<script lang="ts">
import { HugeiconsIcon, type HugeiconsIconName } from "@acepe/ui/icons";
import { cn } from "$lib/utils.js";

interface Props {
	/** Hugeicons name from @acepe/ui/icons. Defaults to the shared sparkle icon. */
	iconName?: HugeiconsIconName;
	/** Short headline — e.g., "MCP servers coming soon". */
	headline: string;
	/** One-sentence description of what will live here. */
	description: string;
	class?: string;
}

let { iconName = "sparkle", headline, description, class: className }: Props = $props();
</script>

<div
	class={cn(
		"flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
		className
	)}
>
	<HugeiconsIcon name={iconName} class="size-4 text-muted-foreground/50" />
	<div class="flex max-w-[320px] flex-col gap-0.5">
		<p class="text-xs font-medium text-foreground/80">{headline}</p>
		<p class="text-[11px] leading-snug text-muted-foreground/60">{description}</p>
	</div>
	<span class="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/50">
		Coming soon
	</span>
</div>
