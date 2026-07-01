<script lang="ts">
	import type { AgentPanelModifiedFileItem } from "./types.js";

	import { DiffPill } from "../diff-pill/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		file: AgentPanelModifiedFileItem;
		isSelected?: boolean;
	}

	let { file, isSelected = false }: Props = $props();

	const reviewIndicator = $derived.by(() => {
		if (file.reviewStatus === "accepted") {
			return {
				label: "Reviewed",
				icon: "accepted" as const,
				iconClassName: "text-success",
			};
		}
		if (file.reviewStatus === "partial") {
			return {
				label: "Partial",
				icon: "partial" as const,
				iconClassName: "text-primary",
			};
		}
		if (file.reviewStatus === "denied") {
			return {
				label: "Undone",
				icon: "denied" as const,
				iconClassName: "text-destructive",
			};
		}
		return {
			label: "Not reviewed",
			icon: null,
			iconClassName: "text-muted-foreground",
		};
	});
</script>

<div class="group relative">
	<button
		type="button"
		onclick={() => file.onSelect?.()}
		data-selected={isSelected ? "true" : "false"}
		title={reviewIndicator.label}
		class="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm transition-colors {isSelected
			? 'bg-accent text-foreground font-medium'
			: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
	>
		<!-- Status icon left of the file chip -->
		<span class="shrink-0 {reviewIndicator.iconClassName}" aria-label={reviewIndicator.label}>
			{#if reviewIndicator.icon === "accepted"}
				<RoundedIcon name="check-circle" class="h-3 w-3" />
			{:else if reviewIndicator.icon === "partial"}
				<RoundedIcon name="circle-dashed" class="h-3 w-3" data-testid="partial-review-circle-dashed-icon" />
			{:else if reviewIndicator.icon === "denied"}
				<RoundedIcon name="x-circle" class="h-3 w-3" />
			{:else}
				<!-- unreviewed: neutral dot placeholder so column width stays consistent -->
				<span class="block h-3 w-3 rounded-full border border-current opacity-30"></span>
			{/if}
		</span>

		<FilePathBadge
			filePath={file.filePath}
			fileName={file.fileName ?? undefined}
			interactive={false}
			class="!bg-transparent !border-transparent !px-0 min-w-0 flex-1"
		/>

		{#if file.additions > 0 || file.deletions > 0}
			<span class="shrink-0 transition-opacity {file.onRevert ? 'group-hover:opacity-0' : ''}">
				<DiffPill insertions={file.additions} deletions={file.deletions} variant="plain" />
			</span>
		{/if}
	</button>

	{#if file.onRevert}
		<button
			type="button"
			class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
			title="Discard changes"
			onclick={() => file.onRevert?.()}
		>
			<RoundedIcon name="undo" class="size-3" />
		</button>
	{/if}
</div>
