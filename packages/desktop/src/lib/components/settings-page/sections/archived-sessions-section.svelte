<script lang="ts">
import type { SessionSummary } from "$lib/acp/application/dto/session-summary.js";
import { buildSessionSummaryFromCold } from "$lib/acp/application/dto/session-summary.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";

import { getAgentPreferencesStore, getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import { selectArchivedSessions } from "$lib/acp/application/dto/session-archive.js";
import { DEFAULT_PANEL_WIDTH } from "$lib/acp/store/types.js";
import { backendClient } from "$lib/utils/backend-client/index.js";
import * as Effect from "effect/Effect";
import { toast } from "svelte-sonner";
import SessionTable from "$lib/components/settings/project-tab/session-table.svelte";

interface Props {
	projectManager: ProjectManager;
}

let { projectManager }: Props = $props();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const agentPreferencesStore = getAgentPreferencesStore();

// Archived-ness is read from the canonical `archivedAt` the library
// projection carries, the same field the sidebar filters on.
const archivedSessions = $derived.by((): SessionSummary[] => {
	const coldSessions = selectArchivedSessions(
		agentPreferencesStore.filterItemsBySelectedAgents(sessionStore.read.getAllSessions())
	);
	return coldSessions.map((cold) => {
		const listState = sessionStore.read.getSessionListState(cold.id);
		const entryCount = sessionStore.read.getSessionMessageCount(cold.id);
		return buildSessionSummaryFromCold({
			cold,
			listState,
			entryCount,
		});
	});
});

const projects = $derived(projectManager.projects);
const loading = $derived(sessionStore.sessionsLoading);

function handleView(sessionId: string) {
	panelStore.openSession(sessionId, DEFAULT_PANEL_WIDTH);
}

// Unarchive dispatches the canonical command and stops there. SessionUnarchived
// reaches the store on the orchestration stream and clears `archivedAt`, so the
// row leaves this list and returns to the sidebar.
function handleUnarchive(session: { id: string; projectPath: string; agentId: string }) {
	void Effect.runPromise(
		backendClient.acp.unarchiveSession(session.id).pipe(
			Effect.match({
				onSuccess: () => {
					toast.success("Session unarchived");
				},
				onFailure: (error) => {
					toast.error(`Failed to unarchive session: ${error.message}`);
				},
			})
		)
	);
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
