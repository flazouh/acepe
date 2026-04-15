<script lang="ts">
	import type { AgentPanelQueuedMessage } from "./types.js";
	import AgentInputArtefactBadge from "./agent-input-artefact-badge.svelte";

	import { Button } from "../button/index.js";

	interface Props {
		messages: readonly AgentPanelQueuedMessage[];
		isPaused: boolean;
		queueLabel: string;
		pausedLabel: string;
		resumeLabel: string;
		clearLabel: string;
		sendLabel: string;
		cancelLabel: string;
		onCancel: (messageId: string) => void;
		onRemoveAttachment?: (messageId: string, attachmentId: string) => void;
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
		sendLabel,
		cancelLabel,
		onCancel,
		onRemoveAttachment,
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

	/** Max visible characters before truncation */
	const TEXT_TRUNCATE_LIMIT = 280;

	function truncateContent(text: string): string {
		if (text.length <= TEXT_TRUNCATE_LIMIT) return text;
		return text.slice(0, TEXT_TRUNCATE_LIMIT) + "…";
	}
</script>

{#if count > 0}
	<div class="w-full">
		<div class="rounded-t-lg bg-accent/50 overflow-hidden">
			<div class="flex flex-col max-h-[260px] overflow-y-auto">
				{#each displayQueue as message (message.id)}
					{@const isNewest = messages[messages.length - 1]?.id === message.id}
					{@const hasAttachments = (message.attachments?.length ?? 0) > 0}
					<div
						class="queue-message-row flex flex-col gap-1.5 px-3 py-2 text-[0.6875rem] leading-tight border-b border-border/30 last:border-b-0 {isNewest ? 'bg-muted/30' : ''}"
					>
						<!-- Attachment chips -->
						{#if hasAttachments && message.attachments}
							<div class="flex flex-wrap gap-1">
								{#each message.attachments as attachment (attachment.id)}
									<AgentInputArtefactBadge
										displayName={attachment.displayName}
										extension={attachment.extension ?? null}
										kind={attachment.kind}
										onRemove={() => onRemoveAttachment?.(message.id, attachment.id)}
									/>
								{/each}
							</div>
						{/if}

						<!-- Text content + action buttons row -->
						<div class="flex items-start gap-2">
							{#if message.content.trim().length > 0}
								<span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
									{truncateContent(message.content)}
								</span>
							{:else if !hasAttachments}
								<span class="min-w-0 flex-1 text-muted-foreground italic">
									(empty)
								</span>
							{:else}
								<span class="flex-1"></span>
							{/if}

							<div class="flex items-center gap-1 shrink-0" role="none">
								<Button
									variant="headerAction"
									size="headerAction"
									aria-label={cancelLabel}
									title={cancelLabel}
									onclick={() => onCancel(message.id)}
								>
									{cancelLabel}
								</Button>
								<Button
									variant="invert"
									size="headerAction"
									aria-label={sendLabel}
									title={sendLabel}
									onclick={() => onSendNow(message.id)}
								>
									{sendLabel}
								</Button>
							</div>
						</div>
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
