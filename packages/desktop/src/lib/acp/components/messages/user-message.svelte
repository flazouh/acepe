<script lang="ts">
import { RichTokenText } from "@acepe/ui/rich-token-text";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { getPanelStore } from "../../store/index.js";
import type { UserMessage } from "../../types/user-message.js";
import MessageInputContainer from "../message-input-container.svelte";
import CommandOutputCard from "./command-output-card.svelte";
import ContentBlockRouter from "./content-block-router.svelte";
import { resolveProjectFileReference } from "./logic/file-chip-diff-enhancer.js";
import { buildUserMessageDisplayState } from "./user-message-state.js";

let {
	message,
	projectPath: propProjectPath,
}: {
	message: UserMessage;
	projectPath?: string;
} = $props();

const sessionContext = useSessionContext();
const ownerPanelId = $derived(sessionContext?.panelId);
const projectPath = $derived(propProjectPath);
const panelStore = getPanelStore();
const messageState = $derived(buildUserMessageDisplayState(message));

function handleTokenClick(tokenType: string, value: string) {
	if ((tokenType === "file" || tokenType === "image") && projectPath) {
		const fileReference = resolveProjectFileReference(value, projectPath);
		panelStore.openFilePanel(fileReference.filePath, projectPath, {
			ownerPanelId,
			...(fileReference.targetLine !== undefined ? { targetLine: fileReference.targetLine } : {}),
			...(fileReference.targetColumn !== undefined
				? { targetColumn: fileReference.targetColumn }
				: {}),
		});
	}
}
</script>

{#if messageState.isOnlyCommandOutput}
	<!-- Command output only - render without user card wrapper -->
	<div class="mb-2 space-y-1.5">
		{#each messageState.processedChunks as chunk, index (index)}
			{#if chunk.type === "command_output"}
				<CommandOutputCard output={chunk.output} />
			{/if}
		{/each}
	</div>
{:else}
	<!-- Regular user message with card container -->
	<MessageInputContainer class="mb-2 border border-border" timestamp={message.sentAt}>
		<div class="max-h-32 overflow-auto" data-scrollable>
			{#each messageState.processedChunks as chunk, index (index)}
				<div class="space-y-1.5">
					{#if chunk.type === "command_output"}
						<CommandOutputCard output={chunk.output} />
					{:else if chunk.type === "text"}
						<RichTokenText text={chunk.text} onTokenClick={handleTokenClick} />
					{:else}
						<ContentBlockRouter block={chunk.block} {projectPath} />
					{/if}
				</div>
			{/each}
		</div>
	</MessageInputContainer>
{/if}
