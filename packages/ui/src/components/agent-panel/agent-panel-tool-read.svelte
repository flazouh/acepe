<script lang="ts">
	import type { AgentToolFileSelectEvent } from "./types.js";
	import {
		createReadLintsPresentation,
		createToolFileSelectEvent,
		type AgentToolEntry,
	} from "./agent-panel-conversation-entry-model.js";
	import AgentToolRead from "./agent-tool-read.svelte";
	import AgentToolReadLints from "./agent-tool-read-lints.svelte";

	type ReadToolVariant = "read" | "read-lints";

	interface Props {
		entry: AgentToolEntry;
		variant: ReadToolVariant;
		durationLabel?: string;
		iconBasePath?: string;
		onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	}

	let {
		entry,
		variant,
		durationLabel,
		iconBasePath = "",
		onToolFileSelect,
	}: Props = $props();

	const lintsPresentation = $derived(createReadLintsPresentation(entry));

	function handleFileSelect(): void {
		const event = createToolFileSelectEvent(entry);
		if (event === null) {
			return;
		}
		onToolFileSelect?.(event);
	}
</script>

{#if variant === "read-lints"}
	<AgentToolReadLints
		status={entry.status}
		totalDiagnostics={lintsPresentation.totalDiagnostics}
		totalFiles={lintsPresentation.totalFiles}
		diagnostics={entry.lintDiagnostics ?? null}
		summaryLabel={lintsPresentation.summaryLabel}
		{durationLabel}
	/>
{:else}
	<AgentToolRead
		toolCallId={entry.toolCallId ?? entry.id}
		filePath={entry.filePath}
		sourceExcerpt={entry.sourceExcerpt ?? null}
		sourceExcerptHtml={entry.sourceExcerptHtml ?? null}
		sourceRangeLabel={entry.sourceRangeLabel ?? null}
		status={entry.status}
		{durationLabel}
		{iconBasePath}
		interactive={entry.filePath !== undefined}
		onSelect={handleFileSelect}
	/>
{/if}
