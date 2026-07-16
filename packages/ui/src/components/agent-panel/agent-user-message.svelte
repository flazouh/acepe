<script lang="ts">
	import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
	import type { AgentUserContentChunk } from "./types.js";
	import { CommandChip } from "../command-chip/index.js";
	import { RichTokenText } from "../rich-token-text/index.js";
	import { UserMessageContainer } from "../user-message-container/index.js";
	import AgentCopyButton from "./agent-copy-button.svelte";

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

	const timestampDate = $derived.by(() => {
		if (timestampMs == null || Number.isNaN(timestampMs)) return null;
		return new Date(timestampMs);
	});
	const timestampLabel = $derived.by(() => {
		if (timestampDate == null) return null;
		return timestampDate.toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	});
	const timestampTitle = $derived.by(() => {
		if (timestampDate == null) return undefined;
		return timestampDate.toLocaleString();
	});
	const copyText = $derived.by(() => {
		if (hasTextChunks) {
			return textChunks.map((chunk) => chunk.text).join("\n");
		}
		return text;
	});
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
			{#snippet header()}
				{@render messageHeader()}
			{/snippet}
			<div class="flex flex-col gap-1.5">
				{#each textChunks as chunk, index (`${index}:${chunk.text}`)}
					<RichTokenText text={chunk.text} {onTokenClick} class="text-foreground" />
				{/each}
			</div>
		</UserMessageContainer>
	{:else if !isOnlyCommandOutput}
		<UserMessageContainer class="w-full" dataTestid="agent-user-message-card">
			{#snippet header()}
				{@render messageHeader()}
			{/snippet}
			<RichTokenText {text} {onTokenClick} class="text-foreground" />
		</UserMessageContainer>
	{/if}
</div>

{#snippet messageHeader()}
	{#if timestampLabel}
		<span
			class="min-w-0 truncate font-sans text-xs tabular-nums text-muted-foreground"
			title={timestampTitle}
			data-testid="agent-user-message-timestamp"
		>
			{timestampLabel}
		</span>
	{:else}
		<span class="min-w-0 flex-1"></span>
	{/if}
	<div class="ml-auto flex shrink-0 items-center gap-1">
		<AgentCopyButton text={copyText} size="header" class="text-muted-foreground" />
	</div>
{/snippet}
