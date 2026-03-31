<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import { Button } from "$lib/components/ui/button/index.js";
import * as m from "$lib/paraglide/messages.js";

import AnimatedChevron from "./animated-chevron.svelte";

interface Props {
	isLoading: boolean;
	isCompact: boolean;
	displayName: string;
	isOpen: boolean;
	triggerProps: Record<string, unknown>;
	buttonRef?: HTMLButtonElement | null;
}

let {
	isLoading,
	isCompact,
	displayName,
	isOpen,
	triggerProps,
	buttonRef = $bindable(null),
}: Props = $props();
</script>

<div class="flex h-7 items-center gap-0.5 rounded-full p-0.5 transition-colors hover:bg-accent">
	<Button
		bind:ref={buttonRef}
		{...triggerProps}
		variant="ghost"
		class="group/button h-6 gap-1 rounded-full px-2 text-[11px] font-medium"
		disabled={isLoading}
	>
		{#if isLoading}
			{#if !isCompact}
				<TextShimmer class="text-[11px] font-medium text-muted-foreground">
					{m.model_selector_loading_models()}
				</TextShimmer>
			{/if}
		{:else if !isCompact}
			<span>{displayName}</span>
		{/if}
		<AnimatedChevron {isOpen} class="h-3.5 w-3.5 shrink-0" />
	</Button>
</div>
