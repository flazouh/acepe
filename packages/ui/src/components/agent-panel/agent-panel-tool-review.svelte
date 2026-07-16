<script lang="ts">
	import { Button } from "../button/index.js";
	import { DiffPill } from "../diff-pill/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import { createReviewActionEvent, type AgentToolEntry } from "./agent-panel-conversation-entry-model.js";
	import type { AgentPanelReviewActionEvent } from "./types.js";
	import type { ToolDurationTiming } from "./tool-duration.js";

	interface Props {
		entry: AgentToolEntry;
		durationTiming?: ToolDurationTiming;
		iconBasePath?: string;
		onReview?: (event: AgentPanelReviewActionEvent) => void;
	}

	let { entry, iconBasePath = "/svgs/icons", onReview }: Props = $props();

	const files = $derived(entry.reviewFiles ?? []);
	const fileCountLabel = $derived(files.length === 1 ? "1 file" : `${files.length} files`);
	const totalDiff = $derived.by(() => {
		let additions = 0;
		let deletions = 0;
		for (const file of files) {
			additions += file.additions;
			deletions += file.deletions;
		}
		return { additions, deletions };
	});
	const reviewDisabled = $derived(files.length === 0 || onReview === undefined);

	function handleReview(): void {
		if (reviewDisabled) {
			return;
		}
		onReview?.(createReviewActionEvent(entry));
	}
</script>

<AgentToolCard dataTestid="agent-panel-tool-review">
	<div class="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-sm">
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<ToolHeaderLeading kind="review" status={entry.status}>
				{entry.title}
			</ToolHeaderLeading>
			<span class="shrink-0 text-xs text-muted-foreground/70">{fileCountLabel}</span>
			<span class="shrink-0" data-testid="agent-panel-tool-review-total-diff">
				<DiffPill
					insertions={totalDiff.additions}
					deletions={totalDiff.deletions}
					variant="plain"
				/>
			</span>
		</div>

		<Button
			variant="secondary"
			size="xs"
			disabled={reviewDisabled}
			onclick={handleReview}
		>
			Review
		</Button>
	</div>

	{#if files.length > 0}
		<div
			class="max-h-[220px] overflow-y-auto border-t border-border p-1"
			data-testid="agent-panel-tool-review-files"
		>
			{#each files as file (file.id)}
				<div class="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-sm text-muted-foreground">
					<FilePathBadge
						filePath={file.filePath}
						fileName={file.fileName ?? undefined}
						interactive={false}
						variant="plain"
						class="min-w-0 flex-1 !bg-transparent !px-0"
						{iconBasePath}
					/>
					<DiffPill
						insertions={file.additions}
						deletions={file.deletions}
						variant="plain"
						class="shrink-0"
					/>
				</div>
			{/each}
		</div>
	{:else}
		<div
			class="border-t border-border px-2.5 py-2 text-xs text-muted-foreground"
			data-testid="agent-panel-tool-review-files"
		>
			No edited files
		</div>
	{/if}
</AgentToolCard>
