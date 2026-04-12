<script lang="ts">
	import { ArrowUp, PencilSimple, Trash } from "phosphor-svelte";
	import type { AgentPanelQueuedMessage } from "./types.js";

	import { Button } from "../button/index.js";

	interface Props {
		messages: readonly AgentPanelQueuedMessage[];
		isPaused: boolean;
		queueLabel: string;
		pausedLabel: string;
		resumeLabel: string;
		clearLabel: string;
		editLabel: string;
		deleteLabel: string;
		sendLabel: string;
		saveLabel: string;
		cancelLabel: string;
		onSaveEdit: (messageId: string, content: string) => void;
		onRemove: (messageId: string) => void;
		onClear: () => void;
		onResume?: (() => void) | undefined;
		onSendNow: (messageId: string) => void;
	}

	const {
		messages,
		isPaused,
		queueLabel,
		pausedLabel,
		resumeLabel,
		clearLabel,
		editLabel,
		deleteLabel,
		sendLabel,
		saveLabel,
		cancelLabel,
		onSaveEdit,
		onRemove,
		onClear,
		onResume,
		onSendNow,
	}: Props = $props();

	const count = $derived(messages.length);
	const displayQueue = $derived.by(() => {
		const ordered: AgentPanelQueuedMessage[] = [];

		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
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
		if (trimmed.length === 0) return;
		onSaveEdit(editingMessageId, trimmed);
		editingMessageId = null;
		editingContent = "";
	}

	function handleCancelEdit(): void {
		editingMessageId = null;
		editingContent = "";
	}

	function handleRemove(messageId: string): void {
		onRemove(messageId);
		if (editingMessageId === messageId) {
			handleCancelEdit();
		}
	}
</script>

{#if count > 0}
	<div class="w-full">
		<div class="rounded-t-lg bg-accent/50 overflow-hidden">
			<div class="flex flex-col max-h-[260px] overflow-y-auto">
				{#each displayQueue as message (message.id)}
					{@const isNewest = messages[messages.length - 1]?.id === message.id}
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
										{cancelLabel}
									</button>
									<button
										type="button"
										class="flex items-center gap-1 rounded border border-border/50 bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground/75 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
										onclick={handleSaveEdit}
									>
										{saveLabel}
									</button>
								</div>
							</div>
						{:else}
							<div class="flex min-w-0 flex-1 items-start gap-2">
								<span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
									{message.content}
								</span>

								{#if message.attachmentCount > 0}
									<span class="shrink-0 pt-0.5 font-mono text-[0.625rem] text-muted-foreground">
										+{message.attachmentCount}
									</span>
								{/if}
							</div>

							<div class="flex items-center gap-0.5 shrink-0" role="none">
								<Button
									variant="ghost"
									size="icon-sm"
									class="size-6"
									aria-label={editLabel}
									title={editLabel}
									onclick={() => handleStartEdit(message.id, message.content)}
								>
									<PencilSimple weight="fill" class="h-3 w-3" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									class="size-6"
									aria-label={deleteLabel}
									title={deleteLabel}
									onclick={() => handleRemove(message.id)}
								>
									<Trash weight="fill" class="h-3 w-3" />
								</Button>
								<Button
									type="button"
									size="sm"
									class="size-6 rounded-full border-transparent bg-foreground p-0 text-background shadow-none hover:bg-foreground/85"
									aria-label={sendLabel}
									title={sendLabel}
									onclick={() => onSendNow(message.id)}
								>
									<ArrowUp weight="bold" class="h-3 w-3" />
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<div class="w-full flex items-center justify-between px-3 py-1 rounded-b-lg bg-accent">
			<div class="flex items-center gap-1.5 text-[0.6875rem] min-w-0">
				<span class="font-medium text-foreground shrink-0">{queueLabel} ({count})</span>
				{#if isPaused}
					<span class="text-muted-foreground">· {pausedLabel}</span>
				{/if}
			</div>

			<div class="flex items-center gap-1 shrink-0" role="none">
				{#if isPaused && onResume}
					<Button variant="headerAction" size="headerAction" onclick={onResume}>
						{resumeLabel}
					</Button>
				{/if}
				<Button variant="headerAction" size="headerAction" onclick={onClear}>
					{clearLabel}
				</Button>
			</div>
		</div>
	</div>
{/if}
