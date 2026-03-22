<script lang="ts">
import type { SessionSummary } from "$lib/acp/application/dto/session.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";

import { getAgentPreferencesStore, getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import { getSessionArchiveStore } from "$lib/acp/store/session-archive-store.svelte.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import * as m from "$lib/paraglide/messages.js";

import SessionTable from "./project-tab/session-table.svelte";

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
const activeSessions = $derived(allSessions.filter((session) => !archiveStore.isArchived(session)));
const projects = $derived(projectManager.projects);
const loading = $derived(sessionStore.loading);

function handleView(sessionId: string) {
	panelStore.openSession(sessionId, DEFAULT_PANEL_WIDTH);
}

function handleDelete(_sessionId: string) {
	if (confirm("Are you sure you want to delete this session?")) {
		console.warn("deleteSession not yet implemented in UnifiedStore");
	}
}

function handleOpenInFinder(_sessionId: string, _projectPath: string) {
	console.warn("open_session_in_finder not yet implemented");
}

function handleArchive(session: { id: string; projectPath: string; agentId: string }) {
	void archiveStore
		.archive({
			sessionId: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
		})
		.match(
			() => undefined,
			() => undefined
		);
}
</script>

<div class="flex flex-col h-full min-h-0 gap-3 text-sm">
	<div class="shrink-0">
		<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground/60">
			{m.settings_project_sessions()}
		</h2>
		<p class="text-xs text-muted-foreground/50 mt-0.5">
			{m.settings_project_sessions_description()}
		</p>
	</div>

	<div class="flex-1 min-h-0">
		<SessionTable
			class="h-full min-h-0"
			sessions={activeSessions}
			{projects}
			{loading}
			onView={handleView}
			onDelete={handleDelete}
			onOpenInFinder={handleOpenInFinder}
			onArchive={handleArchive}
		/>
	</div>
</div>
