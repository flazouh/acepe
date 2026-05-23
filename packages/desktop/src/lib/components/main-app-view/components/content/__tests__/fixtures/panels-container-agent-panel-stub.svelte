<script lang="ts">
import { onMount } from "svelte";
import {
	getAgentPanelRenderCount,
	recordAgentPanelDestroy,
	recordAgentPanelMount,
	recordAgentPanelRender,
} from "./panels-container-agent-panel-stub-state";

interface ProjectRef {
	readonly path: string;
}

interface AgentRef {
	readonly id: string;
}

interface Props {
	panelId: string;
	project?: ProjectRef | null;
	selectedAgentId?: string | null;
	pendingProjectSelection?: boolean;
	isFullscreen?: boolean;
	availableAgents?: readonly AgentRef[];
	hasAttachedFilePane?: boolean;
}

let {
	panelId,
	project = null,
	selectedAgentId = null,
	pendingProjectSelection = false,
	isFullscreen = false,
	availableAgents = [],
	hasAttachedFilePane = false,
}: Props = $props();

onMount(() => {
	recordAgentPanelMount(panelId);
	return () => recordAgentPanelDestroy(panelId);
});

const projectPath = $derived(project?.path ?? "no-project");
const selectedAgent = $derived(selectedAgentId ?? "no-agent");
const availableAgentCount = $derived(availableAgents.length);
const attachedFileCount = $derived(hasAttachedFilePane ? 1 : 0);
const renderTick = $derived.by(() => {
	recordAgentPanelRender(panelId);
	return getAgentPanelRenderCount(panelId);
});
</script>

<div
	data-testid={`agent-panel-${panelId}`}
	data-render-tick={String(renderTick)}
	data-project-path={projectPath}
	data-selected-agent={selectedAgent}
	data-pending-project-selection={pendingProjectSelection ? "true" : "false"}
	data-is-fullscreen={isFullscreen ? "true" : "false"}
	data-available-agent-count={String(availableAgentCount)}
	data-attached-file-count={String(attachedFileCount)}
>
	{panelId}
</div>
