<script lang="ts">
	import { CheckCircle, CircleDashed, XCircle } from "phosphor-svelte";

	import type { AgentPanelModifiedFileItem } from "./types.js";

	import { DiffPill } from "../diff-pill/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";

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

<button
	type="button"
	onclick={() => file.onSelect?.()}
	data-selected={isSelected ? "true" : "false"}
	title={reviewIndicator.label}
	class="group flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm transition-colors {isSelected
		? 'bg-accent text-foreground font-medium'
		: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
>
	<!-- Status icon left of the file chip -->
	<span class="shrink-0 {reviewIndicator.iconClassName}" aria-label={reviewIndicator.label}>
		{#if reviewIndicator.icon === "accepted"}
			<CheckCircle class="h-3 w-3" weight="fill" />
		{:else if reviewIndicator.icon === "partial"}
			<CircleDashed class="h-3 w-3" weight="bold" />
		{:else if reviewIndicator.icon === "denied"}
			<XCircle class="h-3 w-3" weight="fill" />
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
		<span class="shrink-0">
			<DiffPill insertions={file.additions} deletions={file.deletions} variant="plain" />
		</span>
	{/if}
</button>
