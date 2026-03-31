<script lang="ts">
import * as m from "$lib/paraglide/messages.js";
import FloppyDisk from "phosphor-svelte/lib/FloppyDisk";
import PaperPlaneRight from "phosphor-svelte/lib/PaperPlaneRight";
import PencilSimple from "phosphor-svelte/lib/PencilSimple";
import Queue from "phosphor-svelte/lib/Queue";
import Trash from "phosphor-svelte/lib/Trash";
import X from "phosphor-svelte/lib/X";

import { getMessageQueueStore } from "../store/message-queue/message-queue-store.svelte.js";
import type { QueuedMessage } from "../store/message-queue/types.js";

interface Props {
	sessionId: string;
}

const { sessionId }: Props = $props();

const messageQueueStore = getMessageQueueStore();

const queueVersion = $derived.by(() => {
	const version = messageQueueStore.versions.get(sessionId);
	return version !== undefined ? version : 0;
});
const queue = $derived.by(() => {
	queueVersion;
	return messageQueueStore.getQueue(sessionId);
});
const isPaused = $derived(messageQueueStore.pausedIds.has(sessionId));
const count = $derived(queue.length);
const latestMessage = $derived(count > 0 ? queue[count - 1] : null);
const displayQueue = $derived.by(() => {
	const ordered: QueuedMessage[] = [];

	for (let index = queue.length - 1; index >= 0; index -= 1) {
		const message = queue[index];
		if (message) {
			ordered.push(message);
		}
	}

	return ordered;
});

let editingMessageId = $state<string | null>(null);
let editingContent = $state("");

function handleStartEdit(messageId: string, content: string): void {
	editingMessageId = messageId;
	editingContent = content;
}

function handleSaveEdit(): void {
	if (!editingMessageId) return;
	const trimmed = editingContent.trim();
	if (!trimmed) return;
	const updated = messageQueueStore.updateMessage(sessionId, editingMessageId, trimmed);
	if (!updated) return;
	editingMessageId = null;
	editingContent = "";
}

function handleCancelEdit(): void {
	editingMessageId = null;
	editingContent = "";
}

function handleRemove(messageId: string): void {
	messageQueueStore.removeMessage(sessionId, messageId);
	if (editingMessageId === messageId) {
		handleCancelEdit();
	}
}

function handleClear(): void {
	messageQueueStore.clearQueue(sessionId);
	handleCancelEdit();
}

function handleResume(): void {
	messageQueueStore.resume(sessionId);
}

function handleSendNow(messageId: string): void {
	messageQueueStore.sendNow(sessionId, messageId);
}

function truncate(text: string, maxLength: number): string {
	const lines = text.split("\n");
	const firstLine = lines[0] ? lines[0] : text;
	if (firstLine.length <= maxLength) return firstLine;
	return `${firstLine.slice(0, maxLength)}...`;
}
</script>

{#if count > 0}
	<div class="w-full px-5">
		<!-- Message rows (always visible, above the bar) -->
		<div class="rounded-t-lg bg-accent/50 overflow-hidden">
			<div class="flex flex-col max-h-[260px] overflow-y-auto">
				{#each displayQueue as message (message.id)}
					{@const isNewest = latestMessage !== null && latestMessage.id === message.id}
					<div
						class="queue-message-row flex items-start gap-2 px-3 py-1.5 text-[0.6875rem] leading-tight border-b border-border/30 last:border-b-0 {isNewest ? 'bg-muted/30' : ''}"
					>
						{#if editingMessageId === message.id}
							<div class="flex-1 flex flex-col gap-1.5 py-0.5">
								<textarea
									bind:value={editingContent}
									class="min-h-[60px] max-h-[120px] w-full resize-y rounded border border-border bg-background px-2 py-1 text-[0.6875rem] outline-none focus:ring-1 focus:ring-primary/40"
								></textarea>
								<div class="flex items-center justify-end gap-1">
									<button
										type="button"
										class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground/75 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
										onclick={handleCancelEdit}
									>
										<X size={10} weight="bold" class="shrink-0" />
										{m.common_cancel()}
									</button>
									<button
										type="button"
										class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground/75 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
										onclick={handleSaveEdit}
									>
										<FloppyDisk size={10} weight="bold" class="shrink-0" />
										{m.common_save()}
									</button>
								</div>
							</div>
						{:else}
							<!-- Message content -->
							<span class="flex-1 min-w-0 whitespace-pre-wrap break-words text-foreground">
								{message.content}
							</span>

							{#if message.attachments.length > 0}
								<span class="shrink-0 text-muted-foreground font-mono text-[0.625rem]">
									+{message.attachments.length}
								</span>
							{/if}

							<!-- Actions -->
							<div class="flex items-center gap-1 shrink-0" role="none">
								<button
									type="button"
									class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground/75 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
									onclick={() => handleSendNow(message.id)}
								>
									<PaperPlaneRight size={10} weight="bold" class="shrink-0" />
									{m.agent_input_queue_send_now()}
								</button>
								<button
									type="button"
									class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground/75 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
									onclick={() => handleStartEdit(message.id, message.content)}
								>
									<PencilSimple size={10} weight="bold" class="shrink-0" />
									{m.common_edit()}
								</button>
								<button
									type="button"
									class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground/75 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
									onclick={() => handleRemove(message.id)}
								>
									<Trash size={10} weight="bold" class="shrink-0" />
									{m.common_delete()}
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- Footer bar (matches todo-header / modified-files-header style) -->
		<div
			class="w-full flex items-center justify-between px-3 py-1 rounded-b-lg bg-accent"
		>
			<div class="flex items-center gap-1.5 text-[0.6875rem] min-w-0">
				<Queue size={13} weight="fill" class="shrink-0 text-muted-foreground" />
				<span class="font-medium text-foreground shrink-0">{m.agent_input_queued_messages()} ({count})</span>
				{#if isPaused}
					<span class="text-muted-foreground">· {m.agent_input_queue_paused()}</span>
				{/if}
				{#if latestMessage}
					<span class="truncate text-muted-foreground">{truncate(latestMessage.content, 60)}</span>
				{/if}
			</div>

			<div class="flex items-center gap-1 shrink-0" role="none">
				{#if isPaused}
					<button
						type="button"
						class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-foreground/75 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
						onclick={handleResume}
					>
						{m.agent_input_queue_resume()}
					</button>
				{/if}
				<button
					type="button"
					class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-foreground/75 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
					onclick={handleClear}
				>
					{m.agent_input_queue_clear()}
				</button>
			</div>
		</div>
	</div>
{/if}
