<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import FileIcon from "@lucide/svelte/icons/file";
import { Button } from "$lib/components/ui/button/index.js";
import { openFileInEditor } from "$lib/utils/tauri-client.js";

import type { ToolCallThinkState } from "../state/tool-call-think-state.svelte.js";

interface Props {
	state: ToolCallThinkState;
}

let { state }: Props = $props();

function handleOpenFile() {
	const filePath = state.skillMeta?.filePath;
	if (filePath) {
		openFileInEditor(filePath);
	}
}
</script>

<div class="flex flex-col gap-1">
	<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
		{#if state.isLive}
			<TextShimmer class="font-medium font-mono">
				{#if state.skill?.skill}
					/{state.skill.skill}
				{:else}
					Skill
				{/if}
			</TextShimmer>
		{:else}
			<span class="font-medium font-mono">
				{#if state.skill?.skill}
					/{state.skill.skill}
				{:else}
					Skill
				{/if}
			</span>
		{/if}
		{#if state.skill?.args}
			<span class="text-muted-foreground/70 truncate max-w-md font-mono text-[10px]">
				{state.skill.args}
			</span>
		{/if}
		{#if state.skillMeta?.filePath}
			<Button variant="ghost" size="sm" class="h-5 px-1.5 text-[10px]" onclick={handleOpenFile}>
				<FileIcon class="size-3 mr-1" />
				Open
			</Button>
		{/if}
	</div>
	{#if state.skillMeta?.description}
		<p class="text-xs text-muted-foreground/80 line-clamp-2 ml-0.5">
			{state.skillMeta.description}
		</p>
	{/if}
</div>
