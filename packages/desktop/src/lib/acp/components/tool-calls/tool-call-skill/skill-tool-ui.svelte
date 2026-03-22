<script lang="ts">
import { AgentToolCard } from "@acepe/ui/agent-panel";
import { getSessionStore } from "../../../store/index.js";
import type { TurnState } from "../../../store/types.js";
import type { ToolCall } from "../../../types/tool-call.js";
import { extractSkillCallInput } from "../../../utils/extract-skill-call-input.js";
import { getToolStatus } from "../../../utils/tool-state-utils.js";
import SkillToolContent from "./skill-tool-content.svelte";
import SkillToolHeader from "./skill-tool-header.svelte";

interface Props {
	/** The tool call to display */
	toolCall: ToolCall;
	/** Turn state for dynamic UI updates */
	turnState?: TurnState;
	/** Project path for file operations */
	projectPath?: string;
}

let { toolCall, turnState, projectPath }: Props = $props();

// Get comprehensive tool status (includes interrupt detection)
const toolStatus = $derived(getToolStatus(toolCall, turnState));

const sessionStore = getSessionStore();
// UI state - start collapsed, user can expand
let isExpanded = $state(false);

// Extract skill data from tool arguments
// Priority: 1) streaming arguments, 2) toolCall.arguments
const extractedSkill = $derived.by(() => {
	// 1. Try streaming arguments first (for progressive display)
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	const streamingSkill = extractSkillCallInput(streamingArgs);
	if (streamingSkill.skill) {
		return streamingSkill;
	}

	// 2. Fallback to full tool call arguments
	return extractSkillCallInput(toolCall.arguments);
});

// Get skill metadata from toolCall
const skillMeta = $derived(toolCall.skillMeta);

// Determine if we have content to show
const hasContent = $derived(
	Boolean(
		(skillMeta?.description && skillMeta.description.trim().length > 0) ||
			(skillMeta?.filePath && skillMeta.filePath.trim().length > 0)
	)
);

function handleToggleExpand() {
	isExpanded = !isExpanded;
}

function handleClickExpand() {
	if (!isExpanded) {
		isExpanded = true;
	}
}
</script>

<!-- Show simple header when streaming without skill name, otherwise show card -->
{#if toolStatus.isInputStreaming && !extractedSkill.skill}
	<div class="rounded-lg border border-border bg-muted/30 overflow-hidden">
		<SkillToolHeader
			status={toolCall.status}
			{toolStatus}
			skillName={null}
			skillArgs={null}
			{hasContent}
			{isExpanded}
			onToggleExpand={handleToggleExpand}
		/>
	</div>
{:else}
	<AgentToolCard>
		<SkillToolHeader
			status={toolCall.status}
			{toolStatus}
			skillName={extractedSkill.skill}
			skillArgs={extractedSkill.args}
			{hasContent}
			{isExpanded}
			onToggleExpand={handleToggleExpand}
		/>

		{#if hasContent}
			<SkillToolContent
				description={skillMeta?.description}
				filePath={skillMeta?.filePath}
				{isExpanded}
				onClickExpand={handleClickExpand}
				{projectPath}
			/>
		{/if}
	</AgentToolCard>
{/if}
