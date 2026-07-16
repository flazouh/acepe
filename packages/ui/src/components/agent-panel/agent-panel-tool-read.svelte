<script lang="ts">
	import type { AgentToolFileSelectEvent } from "./types.js";
	import {
		createReadLintsPresentation,
		createToolFileSelectEvent,
		type AgentToolEntry,
	} from "./agent-panel-conversation-entry-model.js";
	import AgentToolRead from "./agent-tool-read.svelte";
	import AgentToolReadLints from "./agent-tool-read-lints.svelte";

	import type { ToolDurationTiming } from "./tool-duration.js";

	type ReadToolVariant = "read" | "read-lints";

	interface Props {
		entry: AgentToolEntry;
		variant: ReadToolVariant;
		durationTiming?: ToolDurationTiming;
		iconBasePath?: string;
		onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	}

	let {
		entry,
		variant,
		durationTiming,
		iconBasePath = "/svgs/icons",
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
		{durationTiming}
	/>
{:else}
	<AgentToolRead
		toolCallId={entry.toolCallId ?? entry.id}
		filePath={entry.filePath}
		sourceExcerpt={entry.sourceExcerpt ?? null}
		sourceExcerptHtml={entry.sourceExcerptHtml ?? null}
		highlightSource={entry.highlightSource ?? null}
		sourceRangeLabel={entry.sourceRangeLabel ?? null}
		status={entry.status}
		{durationTiming}
		{iconBasePath}
		interactive={entry.filePath !== undefined}
		onSelect={handleFileSelect}
	/>
{/if}
