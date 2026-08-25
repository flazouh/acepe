<script lang="ts">
	import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
	import type { AgentUserContentChunk } from "./types.js";
	import { CommandChip } from "../command-chip/index.js";
	import { RichTokenText } from "../rich-token-text/index.js";
	import { UserMessageContainer } from "../user-message-container/index.js";
	import AgentMessageMeta from "./agent-message-meta.svelte";

	interface Props {
		text: string;
		chunks?: readonly AgentUserContentChunk[];
		onTokenClick?: (tokenType: InlineArtefactTokenType, value: string) => void;
		timestampMs?: number;
	}

	let { text, chunks, onTokenClick, timestampMs }: Props = $props();

	const commandChunks = $derived(
		chunks?.filter((chunk): chunk is Extract<AgentUserContentChunk, { kind: "localCommand" }> => {
			return chunk.kind === "localCommand";
		}) ?? [],
	);
	const textChunks = $derived(
		chunks?.filter((chunk): chunk is Extract<AgentUserContentChunk, { kind: "text" }> => {
			return chunk.kind === "text";
		}) ?? [],
	);
	const hasCommandChunks = $derived(commandChunks.length > 0);
	const hasTextChunks = $derived(textChunks.length > 0);
	const isOnlyCommandOutput = $derived(hasCommandChunks && !hasTextChunks);

	const copyText = $derived.by(() => {
		if (hasTextChunks) {
			return textChunks.map((chunk) => chunk.text).join("\n");
		}
		return text;
	});
	const copyRowClass =
		"flex justify-end pt-1 opacity-0 transition-opacity duration-150 group-hover/user-message:opacity-100 group-focus-within/user-message:opacity-100";
</script>

<div class="group/user-message flex w-full min-w-0 flex-col gap-1.5">
	{#if hasCommandChunks}
		<div class="space-y-1.5">
			{#each commandChunks as chunk (`${chunk.command}:${chunk.stdout}`)}
				<CommandChip model={chunk.chip} />
			{/each}
		</div>
	{/if}

	{#if hasTextChunks}
		<UserMessageContainer class="w-full" dataTestid="agent-user-message-card">
			<div class="flex flex-col gap-1.5">
				{#each textChunks as chunk, index (`${index}:${chunk.text}`)}
					<RichTokenText text={chunk.text} {onTokenClick} class="text-foreground" />
				{/each}
			</div>
		</UserMessageContainer>
		{@render messageCopy()}
	{:else if !isOnlyCommandOutput}
		<UserMessageContainer class="w-full" dataTestid="agent-user-message-card">
			<RichTokenText {text} {onTokenClick} class="text-foreground" />
		</UserMessageContainer>
		{@render messageCopy()}
	{/if}
</div>

{#snippet messageCopy()}
	<div class={copyRowClass} data-testid="agent-user-message-copy">
		<AgentMessageMeta text={copyText} {timestampMs} variant="user" />
	</div>
{/snippet}
