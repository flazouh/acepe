<script lang="ts">
import Play from "phosphor-svelte/lib/Play";
import X from "phosphor-svelte/lib/X";
import * as m from "$lib/paraglide/messages.js";

import { getMessageQueueStore } from "../store/message-queue/message-queue-store.svelte.js";

interface Props {
	sessionId: string;
}

const { sessionId }: Props = $props();

const messageQueueStore = getMessageQueueStore();

const queue = $derived(messageQueueStore.getQueue(sessionId));
const isPaused = $derived(messageQueueStore.isPaused(sessionId));
const count = $derived(queue.length);

function handleRemove(messageId: string) {
	messageQueueStore.removeMessage(sessionId, messageId);
}

function handleClear() {
	messageQueueStore.clearQueue(sessionId);
}

function handleResume() {
	messageQueueStore.resume(sessionId);
}

function truncate(text: string, maxLength: number): string {
	const firstLine = text.split("\n")[0] ?? text;
	if (firstLine.length <= maxLength) return firstLine;
	return `${firstLine.slice(0, maxLength)}…`;
}
</script>

{#if count > 0}
	<div class="w-full px-5 mb-1">
		<div class="flex flex-col gap-1">
			{#each queue as message (message.id)}
				<div
					class="flex items-center gap-2 px-3 py-1 rounded-md bg-accent/50 text-[0.6875rem] group"
				>
					<span class="flex-1 truncate text-muted-foreground">
						{truncate(message.content, 80)}
					</span>
					{#if message.attachments.length > 0}
						<span class="shrink-0 text-muted-foreground/60">
							+{message.attachments.length}
						</span>
					{/if}
					<button
						type="button"
						class="shrink-0 p-0.5 rounded hover:bg-muted/50 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity"
						onclick={() => handleRemove(message.id)}
					>
						<X class="size-3" />
					</button>
				</div>
			{/each}

			<!-- Footer: status + actions -->
			<div class="flex items-center justify-between px-1 text-[0.625rem] text-muted-foreground">
				<span>
					{m.agent_input_queued_messages()} ({count})
					{#if isPaused}
						<span class="text-warning"> · {m.agent_input_queue_paused()}</span>
					{/if}
				</span>
				<div class="flex items-center gap-1.5">
					{#if isPaused}
						<button
							type="button"
							class="flex items-center gap-0.5 hover:text-foreground transition-colors"
							onclick={handleResume}
						>
							<Play class="size-2.5" weight="fill" />
							<span>{m.agent_input_queue_resume()}</span>
						</button>
					{/if}
					<button
						type="button"
						class="hover:text-foreground transition-colors"
						onclick={handleClear}
					>
						{m.agent_input_queue_clear()}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
