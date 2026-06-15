<script lang="ts">
	import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
	import type { AgentUserContentChunk } from "./types.js";
	import { CommandChip } from "../command-chip/index.js";
	import { RichTokenText } from "../rich-token-text/index.js";
	import { UserMessageContainer } from "../user-message-container/index.js";
	import AgentCopyButton from "./agent-copy-button.svelte";
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
</script>

<div class="group/user-message flex flex-col gap-1.5">
	{#if hasCommandChunks}
		<div class="space-y-1.5">
			{#each commandChunks as chunk (`${chunk.command}:${chunk.stdout}`)}
				<CommandChip model={chunk.chip} />
			{/each}
		</div>
	{/if}

	{#if hasTextChunks}
		<div class="flex flex-col items-end gap-0.5">
			<div class="flex items-center">
				<UserMessageContainer class="border border-border">
					<div class="flex flex-col items-end gap-1.5">
						{#each textChunks as chunk, index (`${index}:${chunk.text}`)}
							<RichTokenText text={chunk.text} {onTokenClick} class="text-foreground" />
						{/each}
					</div>
				</UserMessageContainer>
				{@render copyAffordance()}
			</div>
			{@render timeChip()}
		</div>
	{:else if !isOnlyCommandOutput}
		<div class="flex flex-col items-end gap-0.5">
			<div class="flex items-center">
				<UserMessageContainer class="border border-border">
					<RichTokenText {text} {onTokenClick} class="text-foreground" />
				</UserMessageContainer>
				{@render copyAffordance()}
			</div>
			{@render timeChip()}
		</div>
	{/if}
</div>

<!--
	On row hover, this slot expands from zero width — pushing the right-aligned
	bubble to the left — while the copy button springs in from low scale/opacity.
-->
{#snippet copyAffordance()}
	<div
		class="pointer-events-none max-w-0 origin-left scale-90 overflow-hidden opacity-0 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/user-message:pointer-events-auto group-hover/user-message:max-w-12 group-hover/user-message:scale-100 group-hover/user-message:opacity-100 group-focus-within/user-message:pointer-events-auto group-focus-within/user-message:max-w-12 group-focus-within/user-message:scale-100 group-focus-within/user-message:opacity-100"
	>
		<div class="pl-1.5">
			<AgentCopyButton {text} class="rounded-md border border-border/40 bg-muted/40 text-muted-foreground/70" />
		</div>
	</div>
{/snippet}

<!-- The timestamp stays put below the bubble; it just fades in on hover. -->
{#snippet timeChip()}
	<div
		class="opacity-0 transition-opacity duration-150 group-hover/user-message:opacity-100 group-focus-within/user-message:opacity-100"
	>
		<AgentMessageMeta {text} {timestampMs} variant="user" showCopy={false} />
	</div>
{/snippet}
