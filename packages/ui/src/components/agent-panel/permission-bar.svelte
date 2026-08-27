<script lang="ts">
	import type { Snippet } from "svelte";

	import { FilePathBadge } from "../file-path-badge/index.js";

	type Attachment = "standalone" | "tool-call";

	interface Props {
		verb: string;
		filePath?: string | null;
		command?: string | null;
		showFilePath?: boolean;
		showSummary?: boolean;
		compactSummaryLabel?: string;
		attachment?: Attachment;
		leading: Snippet;
		trailing?: Snippet;
		hasTrailing?: boolean;
		progress?: Snippet;
		hasProgress?: boolean;
		actionBar: Snippet;
		editPreview?: Snippet;
		hasEditPreview?: boolean;
	}

	let {
		verb,
		filePath = null,
		command = null,
		showFilePath = true,
		showSummary = true,
		compactSummaryLabel = "Permission required",
		attachment = "standalone",
		leading,
		trailing,
		hasTrailing = false,
		progress,
		hasProgress = false,
		actionBar,
		editPreview,
		hasEditPreview = false,
	}: Props = $props();

	const isAttachedToToolCall = $derived(attachment === "tool-call");
	const cardClass = $derived.by(() => {
		if (isAttachedToToolCall) {
			return "permission-attached-card inline-flex flex-col bg-input/50 permission-card-enter overflow-hidden rounded-b-lg rounded-t-none px-2 py-1";
		}

		return `w-full flex flex-col gap-1.5 bg-input/50 permission-card-enter overflow-hidden px-3 py-1.5 rounded-lg ${command ? "rounded-b-none" : ""}`;
	});
</script>

<div
	class={isAttachedToToolCall
		? "permission-attached-shell relative z-10 inline-flex max-w-full"
		: "w-full"}
>
	<div class={cardClass}>
		{#if !isAttachedToToolCall && (showSummary || (progress && hasProgress) || (trailing && hasTrailing))}
			<div class="flex w-full items-start justify-between gap-1.5">
				{#if showSummary}
					<div class="flex min-w-0 w-full items-center gap-1.5 text-sm">
						<span class="inline-flex shrink-0 items-center justify-center" aria-label={verb} title={verb}>
							{@render leading()}
						</span>
						<span class="shrink-0 text-sm font-medium text-muted-foreground">{verb}</span>
						{#if filePath && showFilePath}
							<div class="min-w-0 flex-1 cursor-pointer">
								<FilePathBadge {filePath} interactive={false} variant="plain" />
							</div>
						{/if}
					</div>
				{/if}

				<div class="flex shrink-0 items-center gap-1.5 self-center">
					{#if progress && hasProgress}
						<div class="permission-tally-bar flex shrink-0 items-center">
							{@render progress()}
						</div>
					{/if}
					{#if trailing && hasTrailing}
						{@render trailing()}
					{/if}
				</div>
			</div>
		{/if}

		<div
			class={isAttachedToToolCall
				? "inline-flex max-w-full items-center"
				: "flex w-full items-center justify-between gap-2"}
		>
			{#if !isAttachedToToolCall && !showSummary}
				<!--
					Icon only. This branch runs when the tool call above already
					names the file or command, and the working row below already
					says "Waiting for your approval" -- spelling out "Permission
					required" between them is the same sentence a third time. The
					label stays as the icon's accessible name.
				-->
				<div class="flex min-w-0 shrink-0 items-center gap-1.5 text-sm">
					<span
						class="inline-flex shrink-0 items-center justify-center"
						aria-label={compactSummaryLabel}
						title={compactSummaryLabel}
					>
						{@render leading()}
					</span>
				</div>
			{/if}
			{@render actionBar()}
		</div>

		{#if editPreview && hasEditPreview}
			<div class="overflow-hidden rounded-lg border border-border bg-background">
				{@render editPreview()}
			</div>
		{/if}
	</div>

	{#if command}
		<div class="permission-command-block max-h-[72px] overflow-y-auto rounded-b-lg bg-input/50 px-2 py-0.5">
			<code class="block min-w-0 whitespace-pre-wrap break-words font-mono text-sm text-foreground/70">
				$ {command}
			</code>
		</div>
	{/if}
</div>

<style>
	.permission-card-enter {
		animation: slideUp 0.2s ease-out;
	}

	.permission-attached-card {
		position: relative;
		border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
	}

	.permission-command-block {
		border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
	}

	.permission-tally-bar {
		min-height: 1rem;
	}

	.permission-tally-bar :global(.voice-download-progress.compact) {
		gap: 2px;
	}

	.permission-tally-bar :global(.voice-download-segments) {
		height: 12px;
	}

	.permission-tally-bar :global(.compact .voice-download-segments) {
		height: 10px;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
