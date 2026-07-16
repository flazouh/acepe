<script lang="ts">
	import {
		createEditToolPresentation,
		type AgentToolEntry,
	} from "./agent-panel-conversation-entry-model.js";
	import type { EditToolTheme } from "./agent-tool-edit-theme.js";
	import AgentToolEdit from "./agent-tool-edit.svelte";

	import type { ToolDurationTiming } from "./tool-duration.js";

	interface Props {
		entry: AgentToolEntry;
		durationTiming?: ToolDurationTiming;
		iconBasePath?: string;
		editToolTheme?: EditToolTheme;
	}

	let {
		entry,
		durationTiming,
		iconBasePath = "/svgs/icons",
		editToolTheme,
	}: Props = $props();

	const presentation = $derived(createEditToolPresentation(entry));
</script>

<AgentToolEdit
	diffs={presentation.diffs}
	filePath={presentation.filePath}
	isStreaming={presentation.isStreaming}
	status={entry.status}
	applied={presentation.applied}
	awaitingApproval={presentation.awaitingApproval}
	defaultExpanded={true}
	{iconBasePath}
	theme={editToolTheme?.theme}
	themeNames={editToolTheme?.themeNames}
	workerPool={editToolTheme?.workerPool}
	onBeforeRender={editToolTheme?.onBeforeRender}
	unsafeCSS={editToolTheme?.unsafeCSS}
	{durationTiming}
/>
