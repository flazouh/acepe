<script lang="ts">
import PencilSimple from "phosphor-svelte/lib/PencilSimple";
import Play from "phosphor-svelte/lib/Play";
import Trash from "phosphor-svelte/lib/Trash";
import * as m from "$lib/paraglide/messages.js";

import { getMessageQueueStore } from "../store/message-queue/message-queue-store.svelte.js";
import AnimatedChevron from "./animated-chevron.svelte";

interface Props {
	sessionId: string;
}

const { sessionId }: Props = $props();

const messageQueueStore = getMessageQueueStore();

const queue = $derived(messageQueueStore.getQueue(sessionId));
const isPaused = $derived(messageQueueStore.isPaused(sessionId));
const count = $derived(queue.length);

let isExpanded = $state(false);
let editingMessageId = $state<string | null>(null);
let editingContent = $state("");

function toggleExpanded(): void {
	isExpanded = !isExpanded;
	if (!isExpanded) {
		editingMessageId = null;
		editingContent = "";
	}
}

function handleStartEdit(messageId: string, content: string): void {
	editingMessageId = messageId;
	editingContent = content;
	isExpanded = true;
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
	if (count === 1) {
		isExpanded = false;
	}
	}

function handleClear() {
	messageQueueStore.clearQueue(sessionId);
	handleCancelEdit();
	isExpanded = false;
}

function handleResume() {
	messageQueueStore.resume(sessionId);
}

function truncate(text: string, maxLength: number): string {
	const firstLine = text.split("\n")[0] ? text.split("\n")[0] : text;
	if (firstLine.length <= maxLength) return firstLine;
	return `${firstLine.slice(0, maxLength)}...`;
}
</script>

{#if count > 0}
	<div class="w-full px-5 mb-2">
		{#if isExpanded}
			<div class="rounded-t-md bg-muted/30 overflow-hidden border border-b-0 border-border">
				<div class="flex flex-col p-1 gap-1 max-h-[260px] overflow-y-auto">
					{#each queue as message (message.id)}
						<div class="rounded-md border border-border/60 bg-background/60 px-3 py-2">
							{#if editingMessageId === message.id}
								<div class="flex flex-col gap-2">
									<textarea
										bind:value={editingContent}
										class="min-h-20 w-full resize-y rounded border border-border bg-background px-2 py-1 text-xs outline-none"
									/>
									<div class="flex items-center justify-end gap-2 text-[0.6875rem]">
										<button type="button" class="hover:text-foreground" onclick={handleCancelEdit}>
											{m.common_cancel()}
										</button>
										<button type="button" class="hover:text-foreground" onclick={handleSaveEdit}>
											{m.common_save()}
										</button>
									</div>
								</div>
							{:else}
								<div class="flex items-start gap-3">
									<div class="min-w-0 flex-1">
										<div class="text-xs text-foreground whitespace-pre-wrap break-words">{message.content}</div>
										{#if message.attachments.length > 0}
											<div class="mt-1 text-[0.625rem] text-muted-foreground">
												+{message.attachments.length}
											</div>
										{/if}
									</div>
									<div class="flex items-center gap-1 shrink-0 text-muted-foreground">
										<button type="button" class="rounded p-1 hover:bg-muted/70 hover:text-foreground" onclick={() => handleStartEdit(message.id, message.content)}>
											<PencilSimple class="size-3" />
											<span class="sr-only">{m.common_edit()}</span>
										</button>
										<button type="button" class="rounded p-1 hover:bg-muted/70 hover:text-foreground" onclick={() => handleRemove(message.id)}>
											<Trash class="size-3" />
											<span class="sr-only">{m.common_delete()}</span>
										</button>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="button"
			tabindex="0"
			onclick={toggleExpanded}
			onkeydown={(event: KeyboardEvent) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggleExpanded();
				}
			}}
			class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors cursor-pointer {isExpanded ? 'rounded-t-none border-t-0' : ''}"
		>
			<div class="flex items-center gap-1.5 text-[0.6875rem] min-w-0">
				<span class="text-foreground">{m.agent_input_queued_messages()} ({count})</span>
				{#if count > 0}
					<span class="truncate text-muted-foreground">{truncate(queue[0].content, 64)}</span>
				{/if}
			</div>

			<div class="flex items-center gap-2 shrink-0 text-[0.6875rem]" onclick={(event: MouseEvent) => event.stopPropagation()} role="none">
				{#if isPaused}
					<button type="button" class="flex items-center gap-1 hover:text-foreground" onclick={handleResume}>
						<Play class="size-2.5" weight="fill" />
						<span>{m.agent_input_queue_resume()}</span>
					</button>
				{/if}
				<button type="button" class="hover:text-foreground" onclick={handleClear}>
					{m.agent_input_queue_clear()}
				</button>
				<AnimatedChevron expanded={isExpanded} />
			</div>
		</div>
	</div>
{/if}
