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
	class="group flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[0.6875rem] transition-colors {isSelected
		? 'bg-accent text-accent-foreground ring-1 ring-ring/50'
		: 'hover:bg-muted/30'}"
>
	<FilePathBadge
		filePath={file.filePath}
		fileName={file.fileName ?? undefined}
		interactive={false}
	/>

	<span
		class="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[0.625rem] leading-none text-foreground"
	>
		{#if reviewIndicator.icon === "accepted"}
			<CheckCircle class="h-3 w-3 shrink-0 {reviewIndicator.iconClassName}" weight="fill" />
		{:else if reviewIndicator.icon === "partial"}
			<CircleDashed class="h-3 w-3 shrink-0 {reviewIndicator.iconClassName}" weight="bold" />
		{:else if reviewIndicator.icon === "denied"}
			<XCircle class="h-3 w-3 shrink-0 {reviewIndicator.iconClassName}" weight="fill" />
		{/if}
		{reviewIndicator.label}
	</span>

	{#if file.additions > 0 || file.deletions > 0}
		<span class="shrink-0">
			<DiffPill insertions={file.additions} deletions={file.deletions} variant="plain" />
		</span>
	{/if}
</button>
