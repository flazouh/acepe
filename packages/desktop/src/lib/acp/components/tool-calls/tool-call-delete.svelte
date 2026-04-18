<script lang="ts">
import { AgentToolCard } from "@acepe/ui/agent-panel";
import { Colors } from "@acepe/ui";
import { FilePathBadge } from "@acepe/ui/file-path-badge";
import { TextShimmer } from "@acepe/ui/text-shimmer";
import { Trash } from "phosphor-svelte";
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

function resolveDeleteFilePaths(toolArguments: ToolCall["arguments"]): string[] {
	if (toolArguments.kind !== "delete") {
		return [];
	}

	const filePaths = toolArguments.file_paths;
	if (filePaths && filePaths.length > 0) {
		return filePaths;
	}

	const filePath = toolArguments.file_path;
	return filePath ? [filePath] : [];
}

const filePaths = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "delete") {
		return resolveDeleteFilePaths(streamingArgs);
	}

	return resolveDeleteFilePaths(toolCall.arguments);
});
const singleFilePath = $derived(filePaths.length === 1 ? filePaths[0] : null);
const multipleFilePaths = $derived(filePaths.length > 1 ? filePaths : []);
const hasMultipleFilePaths = $derived(multipleFilePaths.length > 0);
const containerClass = $derived(
	hasMultipleFilePaths
		? "flex min-h-7 items-start justify-between gap-2 px-2.5 py-1.5"
		: "flex h-7 items-center justify-between gap-2 px-2.5"
);
const contentClass = $derived(
	hasMultipleFilePaths
		? "flex min-w-0 flex-1 flex-col gap-1.5"
		: "flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground"
);

const label = $derived(isPending ? "Deleting" : "Deleted");
</script>

<AgentToolCard variant="muted">
	<div class={containerClass}>
		<div class={contentClass}>
			<div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
				<span class="inline-flex shrink-0 items-center gap-1">
					<Trash weight="bold" class="size-3.5" style="color: {Colors.red}" />
					<span class="shrink-0 text-xs font-normal text-muted-foreground">
						{#if isPending}
							<TextShimmer>{label}</TextShimmer>
						{:else}
							{label}
						{/if}
					</span>
				</span>

				{#if singleFilePath}
					<FilePathBadge
						filePath={singleFilePath}
						fileName={getFileName(singleFilePath)}
						iconBasePath="/svgs/icons"
						interactive={false}
					/>
				{/if}
			</div>

			{#if hasMultipleFilePaths}
				<div class="flex flex-wrap items-center gap-1.5 pl-5">
					<div class="flex flex-wrap items-center gap-1.5">
						{#each multipleFilePaths as currentFilePath (currentFilePath)}
							<FilePathBadge
								filePath={currentFilePath}
								fileName={getFileName(currentFilePath)}
								iconBasePath="/svgs/icons"
								interactive={false}
							/>
						{/each}
					</div>
				</div>
			{/if}
		</div>
		{#if elapsedLabel}
			<span class="shrink-0 font-mono text-[10px] text-muted-foreground/70">{elapsedLabel}</span>
		{/if}
	</div>
</AgentToolCard>
