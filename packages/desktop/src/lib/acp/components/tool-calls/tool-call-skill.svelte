<script lang="ts">
import { AgentToolSkill } from "@acepe/ui/agent-panel";
import { getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { extractSkillCallInput } from "../../utils/extract-skill-call-input.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

const sessionStore = getSessionStore();
const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Extract skill data from tool arguments
// Priority: 1) streaming arguments, 2) toolCall.arguments
const extractedSkill = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	const streamingSkill = extractSkillCallInput(streamingArgs);
	if (streamingSkill.skill) {
		return streamingSkill;
	}

	return extractSkillCallInput(toolCall.arguments);
});

// Get skill metadata from toolCall
const skillMeta = $derived(toolCall.skillMeta);

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});
</script>

<AgentToolSkill
	skillName={extractedSkill.skill}
	skillArgs={extractedSkill.args}
	description={skillMeta?.description ?? null}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	loadingLabel={"Loading skill"}
	fallbackLabel={"Skill"}
	runningStatusLabel={"Running"}
	doneStatusLabel={"Done"}
	ariaExpandLabel={"Expand"}
	ariaCollapseLabel={"Collapse"}
	ariaExpandDescriptionLabel={"Expand to see full description"}
/>
