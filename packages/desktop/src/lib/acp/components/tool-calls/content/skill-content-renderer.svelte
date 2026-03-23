<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import IconExternalLink from "@tabler/icons-svelte/icons/external-link";
import IconPackage from "@tabler/icons-svelte/icons/package";

import type { SkillContent } from "../../../schemas/tool-call-content.schema.js";

interface Props {
	content: SkillContent;
	isStreaming?: boolean;
}

let { content, isStreaming = false }: Props = $props();

// Format display name as /skillName
const displayName = $derived(`/${content.skill}`);

// Truncate args for display
const displayArgs = $derived(
	content.args && content.args.length > 50 ? `${content.args.slice(0, 50)}...` : content.args
);
</script>

<div class="rounded-md border bg-card overflow-hidden">
	<div class="flex items-center gap-2 px-3 py-2">
		<IconPackage class="size-3.5 text-primary" />

		<!-- Skill name -->
		{#if isStreaming}
			<TextShimmer class="text-xs font-medium text-foreground font-mono">
				{displayName}
			</TextShimmer>
		{:else}
			<span class="text-xs font-medium text-foreground font-mono">
				{displayName}
			</span>
		{/if}

		<!-- Args preview -->
		{#if displayArgs}
			<span class="text-xs text-muted-foreground font-mono truncate">
				{displayArgs}
			</span>
		{/if}

		<!-- Open link if file path available -->
		{#if content.filePath}
			<button
				class="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
				title="Open skill file"
			>
				<IconExternalLink class="size-3.5" />
			</button>
		{/if}
	</div>

	<!-- Description if available -->
	{#if content.description}
		<div class="px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
			{content.description}
		</div>
	{/if}
</div>
