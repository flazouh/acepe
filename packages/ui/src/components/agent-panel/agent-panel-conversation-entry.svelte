<script lang="ts">
	import type { Snippet } from "svelte";
	import type {
		AgentPanelConversationEntry,
		AgentPanelPlanActionEvent,
		AgentPanelPlanViewEvent,
		AgentPanelQuestionSelectEvent,
		AgentPanelReviewActionEvent,
		AgentToolFileSelectEvent,
		AssistantRenderBlockContext,
	} from "./types.js";
	import type { StreamingAnimationMode } from "../../lib/assistant-message/types.js";
	import { isToolCallEntry } from "./agent-panel-conversation-entry-model.js";

	import AgentAssistantMessage from "./agent-assistant-message.svelte";
	import AgentPanelToolEntry from "./agent-panel-tool-entry.svelte";
	import AgentThinkingSceneEntry from "./agent-thinking-scene-entry.svelte";
	import AgentUserMessage from "./agent-user-message.svelte";
	import AgentMissingSceneEntry from "./agent-missing-scene-entry.svelte";
	import type { EditToolTheme } from "./agent-tool-edit-theme.js";
	export type { EditToolTheme } from "./agent-tool-edit-theme.js";

	interface Props {
		entry: AgentPanelConversationEntry;
		iconBasePath?: string;
		editToolTheme?: EditToolTheme;
		projectPath?: string;
		streamingAnimationMode?: StreamingAnimationMode;
		/** When true, streaming placeholders show the Claude working spark instead of the label. */
		showWorkingSpark?: boolean;
		renderAssistantBlock?: Snippet<[AssistantRenderBlockContext]>;
		onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
		onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
		onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
		onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
		onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
		onReview?: (event: AgentPanelReviewActionEvent) => void;
		isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
	}

	let {
		entry,
		iconBasePath = "",
		editToolTheme,
		projectPath,
		streamingAnimationMode = "smooth",
		showWorkingSpark = false,
		renderAssistantBlock,
		onQuestionSelect,
		onPlanBuild,
		onPlanCancel,
		onPlanViewFull,
		onToolFileSelect,
		onReview,
		isPlanActionAvailable,
	}: Props = $props();
 </script>

{#if entry.type === "user"}
	<AgentUserMessage text={entry.text} chunks={entry.chunks} timestampMs={entry.timestampMs} />
{:else if entry.type === "assistant"}
		<AgentAssistantMessage
			messageId={entry.id}
			message={entry.message ?? {
				chunks: [{ type: "message", block: { type: "text", text: entry.markdown } }],
			}}
			isStreaming={entry.isStreaming}
			tokenRevealCss={entry.tokenRevealCss}
			timestampMs={entry.timestampMs}
			planningStartedAtMs={entry.planningStartedAtMs}
			{projectPath}
			{streamingAnimationMode}
			{showWorkingSpark}
		{iconBasePath}
		renderBlock={renderAssistantBlock}
	/>
{:else if entry.type === "thinking"}
	<AgentThinkingSceneEntry
		durationMs={entry.durationMs}
		startedAtMs={entry.startedAtMs}
		label={entry.label}
		{showWorkingSpark}
	/>
{:else if entry.type === "missing"}
	<AgentMissingSceneEntry
		title={entry.title}
		message={entry.message}
		diagnosticLabel={entry.diagnosticLabel}
	/>
{:else if isToolCallEntry(entry)}
	<AgentPanelToolEntry
		{entry}
		{iconBasePath}
		{editToolTheme}
		{onQuestionSelect}
		{onPlanBuild}
		{onPlanCancel}
		{onPlanViewFull}
		{onToolFileSelect}
		{onReview}
		{isPlanActionAvailable}
	/>
{/if}
