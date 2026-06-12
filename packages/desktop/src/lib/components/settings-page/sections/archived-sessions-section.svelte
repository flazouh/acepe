<script lang="ts">
import type { SessionSummary } from "$lib/acp/application/dto/session-summary.js";
import { buildSessionSummaryFromCold } from "$lib/acp/application/dto/session-summary.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";

import { getAgentPreferencesStore, getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import { getSessionArchiveStore } from "$lib/acp/store/session-archive-store.svelte.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import SessionTable from "$lib/components/settings/project-tab/session-table.svelte";

interface Props {
	projectManager: ProjectManager;
}

let { projectManager }: Props = $props();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const agentPreferencesStore = getAgentPreferencesStore();
const archiveStore = getSessionArchiveStore();

const allSessions = $derived.by((): SessionSummary[] => {
	const coldSessions = agentPreferencesStore.filterItemsBySelectedAgents(
		sessionStore.getAllSessions()
	);
	return coldSessions.map((cold) => {
		const listState = sessionStore.getSessionListState(cold.id);
		const entryCount = sessionStore.getSessionMessageCount(cold.id);
		return buildSessionSummaryFromCold({
			cold,
			listState,
			entryCount,
		});
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

<div class="flex h-full min-h-0 flex-col">
	<SessionTable
		class="min-h-0 flex-1"
		sessions={archivedSessions}
		{projects}
		{loading}
		onView={handleView}
		onUnarchive={handleUnarchive}
		emptyMessage="No archived sessions yet."
	/>
</div>
