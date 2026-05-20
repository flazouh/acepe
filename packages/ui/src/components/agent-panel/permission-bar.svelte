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
			return "permission-attached-card inline-flex flex-col bg-input/30 permission-card-enter rounded-b-sm rounded-t-none px-1 py-1";
		}

		return `w-full flex flex-col gap-1.5 border border-border bg-input/30 permission-card-enter px-3 py-1 rounded-md ${command ? "rounded-b-none border-b-0" : ""}`;
	});
</script>

<div
	class={isAttachedToToolCall
		? "permission-attached-shell relative z-10 inline-flex max-w-full mt-[-1px]"
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
								<FilePathBadge {filePath} interactive={false} />
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
				<div class="flex min-w-0 shrink-0 items-center gap-1.5 text-sm">
					<span
						class="inline-flex shrink-0 items-center justify-center"
						aria-label={compactSummaryLabel}
						title={compactSummaryLabel}
					>
						{@render leading()}
					</span>
					<span class="shrink-0 text-sm font-medium text-muted-foreground">
						{compactSummaryLabel}
					</span>
				</div>
			{/if}
			{@render actionBar()}
		</div>

		{#if editPreview && hasEditPreview}
			<div class="overflow-hidden rounded-md border border-border bg-background">
				{@render editPreview()}
			</div>
		{/if}
	</div>

	{#if command}
		<div class="max-h-[72px] overflow-y-auto rounded-b-md border border-border border-t-0 bg-input/30 px-2 py-0.5">
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
		border-color: var(--border);
		border-style: solid;
		border-width: 0 1px 1px;
	}

	.permission-attached-shell::before {
		background: color-mix(in srgb, var(--input) 30%, var(--background));
		content: "";
		height: 1px;
		inset: -1px 0 auto 0;
		pointer-events: none;
		position: absolute;
	}

	.permission-tally-bar {
		min-height: 1rem;
	}

	.permission-tally-bar :global(.voice-download-progress.compact) {
		gap: 2px;
	}

	.permission-tally-bar :global(.voice-download-segments) {
		grid-auto-columns: 3px;
		gap: 2px;
		height: 9px;
	}

	.permission-tally-bar :global(.voice-download-segment) {
		width: 3px;
		height: 9px;
		border-radius: 1.5px;
	}

	.permission-tally-bar :global(.voice-download-segment-vertical:not(.filled)) {
		height: 6px;
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
