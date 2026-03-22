<script lang="ts">
import type { SessionSummary } from "$lib/acp/application/dto/session.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";

import { getAgentPreferencesStore, getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import { getSessionArchiveStore } from "$lib/acp/store/session-archive-store.svelte.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import SessionTable from "$lib/components/settings/project-tab/session-table.svelte";
import SettingsSectionHeader from "../settings-section-header.svelte";

interface Props {
	projectManager: ProjectManager;
}

let { projectManager }: Props = $props();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const agentPreferencesStore = getAgentPreferencesStore();
const archiveStore = getSessionArchiveStore();

const allSessions = $derived.by((): SessionSummary[] => {
	const coldSessions = agentPreferencesStore.filterItemsBySelectedAgents(sessionStore.sessions);
	return coldSessions.map((cold) => {
		const hot = sessionStore.getHotState(cold.id);
		const entryCount = sessionStore.getEntries(cold.id).length;
		return {
			...cold,
			title: cold.title,
			status: hot.status,
			entryCount,
			isConnected: hot.isConnected,
			isStreaming: hot.turnState === "streaming",
			parentId: cold.parentId,
		};
	});
});

const archivedSessions = $derived(
	allSessions.filter((session) => archiveStore.isArchived(session))
);
const projects = $derived(projectManager.projects);
const loading = $derived(sessionStore.loading);

function handleView(sessionId: string) {
	panelStore.openSession(sessionId, DEFAULT_PANEL_WIDTH);
}

function handleUnarchive(session: { id: string; projectPath: string; agentId: string }) {
	archiveStore.unarchive({
		sessionId: session.id,
		projectPath: session.projectPath,
		agentId: session.agentId,
	});
}
</script>

<div class="flex h-full min-h-0 flex-col gap-10">
	<SettingsSectionHeader
		title="Archived Sessions"
		description="Sessions hidden from the main sidebar. Unarchive to restore them."
	/>

	<SessionTable
		class="flex-1 min-h-0"
		sessions={archivedSessions}
		{projects}
		{loading}
		onView={handleView}
		onUnarchive={handleUnarchive}
		emptyMessage="No archived sessions yet."
	/>
</div>
