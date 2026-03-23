<script lang="ts">
import { FilePathBadge, TextShimmer } from "@acepe/ui";
import Trash from "phosphor-svelte/lib/Trash";
import * as m from "$lib/paraglide/messages.js";
import { getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getFileName } from "../../utils/file-utils.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

const sessionStore = getSessionStore();
const toolStatus = $derived(getToolStatus(toolCall, turnState));
const isPending = $derived(toolStatus.isPending);

// Extract file path (streaming args first for progressive display)
const filePath = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "delete" && streamingArgs.file_path) {
		return streamingArgs.file_path;
	}
	return toolCall.arguments.kind === "delete" ? toolCall.arguments.file_path : null;
});
const fileName = $derived(filePath ? getFileName(filePath) : null);

const label = $derived(isPending ? m.tool_delete_running() : m.tool_delete_completed());
</script>

<div>
	<div class="flex items-start gap-1.5">
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				<!-- Trash icon + label -->
				<span class="inline-flex shrink-0 items-center gap-1">
					<Trash weight="bold" class="size-3.5 text-red-500" />
					<span class="shrink-0 text-xs font-normal text-muted-foreground">
						{#if isPending}
							<TextShimmer>{label}</TextShimmer>
						{:else}
							{label}
						{/if}
					</span>
				</span>

				<!-- File chip -->
				{#if filePath}
					{#if isPending}
						<TextShimmer class="text-muted-foreground" duration={1.2}>
							<FilePathBadge
								{filePath}
								{fileName}
								iconBasePath="/svgs/icons"
								interactive={false}
							/>
						</TextShimmer>
					{:else}
						<FilePathBadge
							{filePath}
							{fileName}
							iconBasePath="/svgs/icons"
							interactive={false}
						/>
					{/if}
				{/if}
			</div>
		</div>
		{#if elapsedLabel}
			<span class="shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground/70">
				{elapsedLabel}
			</span>
		{/if}
	</div>
</div>
