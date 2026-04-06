<script lang="ts">
import { AppSidebarLayout } from "@acepe/ui/app-layout";
import { ResultAsync } from "neverthrow";
import { toast } from "svelte-sonner";
import { copySessionToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import { SessionList } from "$lib/acp/components/index.js";
import type { SessionListItem } from "$lib/acp/components/session-list/session-list-types.js";
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import { LOGGER_IDS } from "$lib/acp/constants/logger-ids.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import {
	getAgentPreferencesStore,
	getAgentStore,
	getPanelStore,
	getSessionStore,
} from "$lib/acp/store/index.js";
import { getSessionArchiveStore } from "$lib/acp/store/session-archive-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { sessionEntriesToMarkdown } from "$lib/acp/utils/session-to-markdown.js";
import { useTheme } from "$lib/components/theme/index.js";
import * as m from "$lib/paraglide/messages.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import {
	ensureProjectHeaderAgentSelected,
	getProjectHeaderAgents,
} from "./app-sidebar-agents.js";

import AppQueueRow from "../app-queue-row.svelte";
import SidebarFooter from "./sidebar-footer.svelte";

const logger = createLogger({
	id: LOGGER_IDS.MAIN_PAGE,
	name: "App Sidebar",
});

interface Props {
	projectManager: ProjectManager;
	state: MainAppViewState;
}

let { projectManager, state: appState }: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const agentPreferencesStore = getAgentPreferencesStore();
const agentStore = getAgentStore();
const archiveStore = getSessionArchiveStore();
const themeState = useTheme();

function handleSelectSession(sessionId: string, sessionInfo?: SessionListItem) {
	appState.handleSelectSession(sessionId, sessionInfo).mapErr(() => {
		// Error handling is done in the handler
	});
}

function handleNewThread() {
	// Defensive guard: don't allow new thread if projectCount is unknown or 0
	if (projectManager.projectCount === null || projectManager.projectCount === 0) {
		return;
	}
	appState.handleNewThread();
}

function handleCreateSession(projectPath: string, agentId?: string) {
	if (agentId) {
		const agentIsSelected = agentPreferencesStore.selectedAgentIds.includes(agentId);
		if (!agentIsSelected) {
			const nextSelectedAgentIds = ensureProjectHeaderAgentSelected(
				agentPreferencesStore.selectedAgentIds,
				agentId
			);

			void agentPreferencesStore.setSelectedAgentIds(nextSelectedAgentIds).match(
				() => undefined,
				(error) => {
					toast.error(error.message);
					logger.error("[ProjectHeaderAgents] Failed to persist selected agents", {
						agentId,
						error,
						projectPath,
					});
				}
			);
		}
	}

	appState.handleNewThreadForProject(projectPath, agentId);
}

function handleProjectColorChange(projectPath: string, color: string) {
	projectManager.updateProjectColor(projectPath, color).mapErr((error) => {
		toast.error(`Failed to update project color: ${error.message}`);
		logger.error("[ProjectColor] Failed to update", { projectPath, color, error });
	});
}

function handleRemoveProject(projectPath: string) {
	// Close all panels associated with this project before removing it
	for (const session of sessionStore.getSessionsForProject(projectPath)) {
		panelStore.closePanelBySessionId(session.id);
		sessionStore.removeSession(session.id);
	}
	for (const tp of panelStore.terminalPanels.filter((p) => p.projectPath === projectPath)) {
		panelStore.closeTerminalPanel(tp.id);
	}
	for (const gp of panelStore.gitPanels.filter((p) => p.projectPath === projectPath)) {
		panelStore.closeGitPanel(gp.id);
	}
	for (const fp of panelStore.filePanels.filter((p) => p.projectPath === projectPath)) {
		panelStore.closeFilePanel(fp.id);
	}
	for (const bp of panelStore.browserPanels.filter((p) => p.projectPath === projectPath)) {
		panelStore.closeBrowserPanel(bp.id);
	}
	panelStore.workspacePanels = panelStore.workspacePanels.filter((panel) => panel.projectPath !== projectPath);

	projectManager.removeProject(projectPath).mapErr((error) => {
		toast.error(`Failed to remove project: ${error.message}`);
		logger.error("[RemoveProject] Failed to remove", { projectPath, error });
	});
}

function handleSelectFile(filePath: string, projectPath: string) {
	panelStore.openFilePanel(filePath, projectPath);
}

function handleFileTreeExpansionChange(expansion: Record<string, string[]>) {
	appState.handleFileTreeExpansionChange(expansion);
}

function handleOpenTerminal(projectPath: string) {
	panelStore.toggleTerminalPanel(projectPath);
}

function handleOpenBrowser(projectPath: string) {
	panelStore.openBrowserPanel(projectPath, "about:blank", "New tab");
}

function handleOpenGitPanel(projectPath: string) {
	panelStore.openGitPanel(projectPath);
}

function handleOpenPr(sessionInfo: SessionListItem) {
	if (sessionInfo.prNumber == null) return;
	panelStore.openGitPanel(sessionInfo.projectPath, undefined, {
		section: "prs",
		prNumber: sessionInfo.prNumber,
	});
}

function handleExportMarkdown(sessionId: string) {
	const entries = sessionStore.getEntries(sessionId);
	const markdown = sessionEntriesToMarkdown(entries);
	ResultAsync.fromPromise(
		navigator.clipboard.writeText(markdown),
		(e) => new Error(String(e))
	).match(
		() => toast.success(m.session_menu_export_success()),
		(err) => {
			toast.error(m.session_menu_export_error({ error: err.message }));
			logger.error("[ExportMarkdown] Failed", { sessionId, error: err });
		}
	);
}

async function handleExportJson(sessionId: string) {
	const cold = sessionStore.getSessionCold(sessionId);
	if (!cold) {
		toast.error(m.session_menu_export_error({ error: "Session not found" }));
		return;
	}
	const entries = sessionStore.getEntries(sessionId);
	copySessionToClipboard({ ...cold, entries, entryCount: entries.length }).match(
		() => toast.success(m.session_menu_export_success()),
		(err) => {
			toast.error(m.session_menu_export_error({ error: err.message }));
			logger.error("[ExportJson] Failed", { sessionId, error: err });
		}
	);
}

async function handleArchiveSession(session: SessionDisplayItem) {
	await archiveStore
		.archive({
			sessionId: session.id,
			projectPath: session.projectPath,
			agentId: session.agentId,
		})
		.match(
			() => {
				toast.success("Session archived");
			},
			(error) => {
				toast.error(`Failed to archive session: ${error.message}`);
			}
		);
}

async function handleRenameSession(sessionId: string, title: string) {
	await sessionStore.renameSession(sessionId, title).match(
		() => {
			toast.success("Session renamed");
		},
		(error) => {
			toast.error(error.message);
			logger.error("[RenameSession] Failed", { error, sessionId, title });
		}
	);
}

// Agent dropdown data for session creation
const availableAgents = $derived(
	getProjectHeaderAgents(agentStore.agents, agentPreferencesStore.selectedAgentIds).map((a) => ({
		id: a.id,
		name: a.name,
		icon: a.icon,
		availability_kind: a.availability_kind,
	}))
);
const effectiveTheme = $derived(themeState.effectiveTheme);

// Performance: Only read hot state (changes infrequently — on connection/turn transitions).
// Do NOT read sessionStore.getEntries() here — entries change every rAF during streaming,
// which would mark this derived dirty on every frame, cascading to ALL SessionItem components.
const visibleSessions = $derived.by(() => {
	const coldSessions = agentPreferencesStore.filterItemsBySelectedAgents(sessionStore.sessions);
	return coldSessions
		.filter((cold) => !archiveStore.isArchived(cold))
		.map((cold) => {
			const hot = sessionStore.getHotState(cold.id);
			return {
				...cold,
				status: hot.status,
				entryCount: 0,
				isConnected: hot.isConnected,
				isStreaming: hot.turnState === "streaming",
			};
		});
});
</script>

<AppSidebarLayout>
	{#snippet queueSection()}
		{#if panelStore.viewMode !== "kanban"}
			<AppQueueRow {projectManager} state={appState} />
		{/if}
	{/snippet}

	{#snippet sessionList()}
		<SessionList
			sessions={visibleSessions}
			loading={sessionStore.loading}
			scanningProjectPaths={sessionStore.scanningProjectPaths}
			recentProjects={projectManager.projects}
			canCreateSession={projectManager.projectCount !== null && projectManager.projectCount > 0}
			initialFileTreeExpansion={appState.fileTreeExpansion}
			initialProjectFileViewModes={appState.projectFileViewModes}
			initialCollapsedProjectPaths={appState.collapsedProjectPaths}
			onSelectSession={handleSelectSession}
			onCreateSession={handleNewThread}
			onCreateSessionForProject={handleCreateSession}
			{availableAgents}
			{effectiveTheme}
			onProjectColorChange={handleProjectColorChange}
			onRemoveProject={handleRemoveProject}
			isSessionOpen={(sessionId) => panelStore.isSessionOpen(sessionId)}
			onSelectFile={handleSelectFile}
			onFileTreeExpansionChange={handleFileTreeExpansionChange}
			onProjectFileViewModeChange={(modes) => appState.handleProjectFileViewModeChange(modes)}
			onCollapsedProjectPathsChange={(paths) => appState.handleCollapsedProjectPathsChange(paths)}
			onOpenTerminal={handleOpenTerminal}
			onOpenBrowser={handleOpenBrowser}
			onOpenGitPanel={handleOpenGitPanel}
			onOpenPr={handleOpenPr}
			onArchiveSession={handleArchiveSession}
			onRenameSession={handleRenameSession}
			onExportMarkdown={handleExportMarkdown}
			onExportJson={handleExportJson}
		/>
	{/snippet}

	{#snippet footer()}
		<SidebarFooter {projectManager} state={appState} onOpenGitPanel={handleOpenGitPanel} />
	{/snippet}
</AppSidebarLayout>
