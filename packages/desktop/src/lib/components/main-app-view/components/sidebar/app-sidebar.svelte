<script lang="ts">
import { AppSidebarLayout } from "@acepe/ui/app-layout";
import { ResultAsync } from "neverthrow";
import { toast } from "svelte-sonner";
import { copySessionToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import { SessionList } from "$lib/acp/components/index.js";
import ProjectIconPickerDialog from "$lib/acp/components/project-icon-picker-dialog.svelte";
import type { SessionListItem } from "$lib/acp/components/session-list/session-list-types.js";
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import { LOGGER_IDS } from "$lib/acp/constants/logger-ids.js";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
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
import * as m from "$lib/messages.js";
import { getAttentionQueueStore } from "$lib/stores/attention-queue-store.svelte.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import { ensureProjectHeaderAgentSelected, getProjectHeaderAgents } from "./app-sidebar-agents.js";

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
const attentionQueueStore = getAttentionQueueStore();

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

function handleChangeProjectIcon(projectPath: string) {
	void projectManager.listProjectImages(projectPath).match(
		(images) => {
			iconPickerProjectPath = projectPath;
			iconPickerImages = images;
			iconPickerOpen = true;
		},
		(error) => {
			toast.error(`Failed to load project images: ${error.message}`);
			logger.error("[ProjectIcon] Failed to list project images", { projectPath, error });
		}
	);
}

function handleResetProjectIcon(projectPath: string) {
	projectManager.updateProjectIcon(projectPath, null).mapErr((error) => {
		toast.error(`Failed to reset project icon: ${error.message}`);
		logger.error("[ProjectIcon] Failed to reset", { projectPath, error });
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
	if (panelStore.gitDialog?.projectPath === projectPath) {
		panelStore.closeGitDialog();
	}
	for (const fp of panelStore.filePanels.filter((p) => p.projectPath === projectPath)) {
		panelStore.closeFilePanel(fp.id);
	}
	for (const bp of panelStore.browserPanels.filter((p) => p.projectPath === projectPath)) {
		panelStore.closeBrowserPanel(bp.id);
	}
	panelStore.workspacePanels = panelStore.workspacePanels.filter(
		(panel) => panel.projectPath !== projectPath
	);

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
	panelStore.openGitDialog(projectPath);
}

function handleOpenPr(sessionInfo: SessionListItem) {
	if (sessionInfo.prNumber == null) return;
	panelStore.openGitDialog(sessionInfo.projectPath, undefined, {
		section: "prs",
		prNumber: sessionInfo.prNumber,
	});
}

function handleRenameSession(sessionInfo: SessionListItem, title: string) {
	void sessionStore.renameSession(sessionInfo.id, title).match(
		() => undefined,
		(error) => {
			toast.error(`Failed to rename session: ${error.message}`);
			logger.error("[RenameSession] Failed", {
				sessionId: sessionInfo.id,
				projectPath: sessionInfo.projectPath,
				title,
				error,
			});
		}
	);
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

let iconPickerOpen = $state(false);
let iconPickerImages = $state<string[]>([]);
let iconPickerProjectPath = $state("");
let reorderInFlight = $state(false);

function copyProject(project: Project, sortOrder: number | undefined = project.sortOrder): Project {
	return {
		path: project.path,
		name: project.name,
		lastOpened: project.lastOpened,
		createdAt: project.createdAt,
		color: project.color,
		sortOrder,
		iconPath: project.iconPath ?? null,
	};
}

function snapshotProjectSortOrders(projects: readonly Project[]): Map<string, number | undefined> {
	const sortOrders = new Map<string, number | undefined>();
	for (const project of projects) {
		sortOrders.set(project.path, project.sortOrder);
	}
	return sortOrders;
}

function restoreProjectSortOrders(
	projects: readonly Project[],
	sortOrders: ReadonlyMap<string, number | undefined>
): Project[] {
	return projects.map((project) => {
		if (!sortOrders.has(project.path)) {
			return copyProject(project);
		}

		return copyProject(project, sortOrders.get(project.path));
	});
}

function compareProjectOrder(a: Project, b: Project): number {
	const aSortOrder = a.sortOrder ?? Number.POSITIVE_INFINITY;
	const bSortOrder = b.sortOrder ?? Number.POSITIVE_INFINITY;
	if (aSortOrder !== bSortOrder) {
		return aSortOrder - bSortOrder;
	}

	return b.createdAt.getTime() - a.createdAt.getTime();
}

function getCurrentProjectOrder(projects: readonly Project[]): string[] {
	return Array.from(projects)
		.sort((a, b) => compareProjectOrder(a, b))
		.map((project) => project.path);
}

function areProjectOrdersEqual(currentOrder: readonly string[], nextOrder: readonly string[]): boolean {
	if (currentOrder.length !== nextOrder.length) {
		return false;
	}

	return currentOrder.every((path, index) => path === nextOrder[index]);
}

function buildOptimisticProjectOrder(
	projects: readonly Project[],
	orderedPaths: readonly string[]
): Project[] {
	const projectByPath = new Map(projects.map((project) => [project.path, project]));
	const remainingProjects = Array.from(projects).sort((a, b) => compareProjectOrder(a, b));
	const reorderedProjects: Project[] = [];
	const includedPaths = new Set<string>();

	for (const path of orderedPaths) {
		const project = projectByPath.get(path);
		if (!project) {
			continue;
		}

		reorderedProjects.push({
			path: project.path,
			name: project.name,
			lastOpened: project.lastOpened,
			createdAt: project.createdAt,
			color: project.color,
			sortOrder: reorderedProjects.length,
			iconPath: project.iconPath ?? null,
		});
		includedPaths.add(project.path);
	}

	for (const project of remainingProjects) {
		if (includedPaths.has(project.path)) {
			continue;
		}

		reorderedProjects.push(copyProject(project, reorderedProjects.length));
	}

	return reorderedProjects;
}

function handleIconPickerOpenChange(open: boolean) {
	iconPickerOpen = open;
	if (!open) {
		iconPickerImages = [];
		iconPickerProjectPath = "";
	}
}

function handleReorderProjects(orderedPaths: string[]) {
	if (reorderInFlight) {
		return;
	}

	const previousSortOrders = snapshotProjectSortOrders(projectManager.projects);
	const previousProjects = projectManager.projects;
	const currentOrder = getCurrentProjectOrder(previousProjects);
	if (areProjectOrdersEqual(currentOrder, orderedPaths)) {
		return;
	}

	reorderInFlight = true;
	projectManager.projects = buildOptimisticProjectOrder(previousProjects, orderedPaths);

	void projectManager
		.updateProjectOrder(orderedPaths)
		.mapErr((error) => {
			projectManager.projects = restoreProjectSortOrders(previousProjects, previousSortOrders);
			logger.error("[ProjectReorder] Failed to persist project order", {
				error,
				orderedPaths,
			});
			return error;
		})
		.match(
			() => {
				reorderInFlight = false;
			},
			() => {
				reorderInFlight = false;
			}
		);
}

function handleSelectProjectIcon(iconPath: string) {
	const projectPath = iconPickerProjectPath;
	if (!projectPath) {
		return;
	}

	void projectManager.updateProjectIcon(projectPath, iconPath).match(
		() => undefined,
		(error) => {
			toast.error(`Failed to update project icon: ${error.message}`);
			logger.error("[ProjectIcon] Failed to change", { projectPath, error });
		}
	);
}

function handleBrowseProjectIcon() {
	const projectPath = iconPickerProjectPath;
	handleIconPickerOpenChange(false);
	if (!projectPath) {
		return;
	}

	projectManager.browseAndSetProjectIcon(projectPath).mapErr((error) => {
		toast.error(`Failed to update project icon: ${error.message}`);
		logger.error("[ProjectIcon] Failed to change", { projectPath, error });
	});
}

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
		{#if panelStore.viewMode !== "kanban" && attentionQueueStore.enabled}
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
			onChangeProjectIcon={handleChangeProjectIcon}
			onResetProjectIcon={handleResetProjectIcon}
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
			onReorderProjects={handleReorderProjects}
		/>
	{/snippet}

	{#snippet footer()}
		<SidebarFooter {projectManager} state={appState} onOpenGitPanel={handleOpenGitPanel} />
	{/snippet}
</AppSidebarLayout>

<ProjectIconPickerDialog
	open={iconPickerOpen}
	projectPath={iconPickerProjectPath}
	images={iconPickerImages}
	onSelect={handleSelectProjectIcon}
	onBrowse={handleBrowseProjectIcon}
	onOpenChange={handleIconPickerOpenChange}
/>
