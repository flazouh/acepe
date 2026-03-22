<script lang="ts">
import { RichTokenText } from "@acepe/ui/rich-token-text";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { getPanelStore } from "../../store/index.js";
import type { UserMessage } from "../../types/user-message.js";
import {
	type CommandOutput,
	hasCommandOutput,
	parseCommandOutput,
} from "../../utils/command-output-parser.js";
import MessageInputContainer from "../message-input-container.svelte";
import CommandOutputCard from "./command-output-card.svelte";
import ContentBlockRouter from "./content-block-router.svelte";
import { normalizeToProjectRelativePath } from "./logic/file-chip-diff-enhancer.js";

let { message }: { message: UserMessage } = $props();

const sessionContext = useSessionContext();
const projectPath = $derived(sessionContext?.projectPath);
const ownerPanelId = $derived(sessionContext?.panelId);
const panelStore = getPanelStore();

type ProcessedChunk =
	| { type: "text"; text: string }
	| { type: "block"; block: unknown }
	| { type: "command_output"; output: CommandOutput };

const processedChunks = $derived.by((): ProcessedChunk[] => {
	return message.chunks.flatMap((chunk): ProcessedChunk[] => {
		const block = chunk as Record<string, unknown>;
		if (block && block.type === "text" && typeof block.text === "string") {
			const text = block.text;

			if (!text.trim()) {
				return [];
			}

			// Check for command output
			if (hasCommandOutput(text)) {
				const segments = parseCommandOutput(text);
				return segments.flatMap((segment): ProcessedChunk[] => {
					if (segment.type === "command_output") {
						return [{ type: "command_output" as const, output: segment.content }];
					} else if (segment.content) {
						return [{ type: "text" as const, text: segment.content }];
					}
					return [];
				});
			}

			return [{ type: "text" as const, text }];
		}
		return [{ type: "block" as const, block: chunk }];
	});
});

// Check if message is entirely command output (no regular blocks)
const isOnlyCommandOutput = $derived(
	processedChunks.length > 0 && processedChunks.every((c) => c.type === "command_output")
);

function handleTokenClick(tokenType: string, value: string) {
	if ((tokenType === "file" || tokenType === "image") && projectPath) {
		const relativePath = normalizeToProjectRelativePath(value, projectPath);
		panelStore.openFilePanel(relativePath, projectPath, { ownerPanelId });
	}
}
</script>

{#if isOnlyCommandOutput}
	<!-- Command output only - render without user card wrapper -->
	<div class="mb-2 space-y-1.5">
		{#each processedChunks as chunk, index (index)}
			{#if chunk.type === "command_output"}
				<CommandOutputCard output={chunk.output} />
			{/if}
		{/each}
	</div>
{:else}
	<!-- Regular user message with card container -->
	<MessageInputContainer class="mb-2 border border-border">
		<div class="max-h-32 overflow-auto" data-scrollable>
			{#each processedChunks as chunk, index (index)}
				<div class="space-y-1.5">
					{#if chunk.type === "command_output"}
						<CommandOutputCard output={chunk.output} />
					{:else if chunk.type === "text"}
						<RichTokenText text={chunk.text} onTokenClick={handleTokenClick} />
					{:else}
						<ContentBlockRouter block={chunk.block} />
					{/if}
				</div>
			{/each}
		</div>
	</MessageInputContainer>
{/if}
