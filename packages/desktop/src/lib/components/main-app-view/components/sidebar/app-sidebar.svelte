<script lang="ts">
import { AppSidebarLayout } from "@acepe/ui/app-layout";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { toast } from "svelte-sonner";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import { SessionList } from "$lib/acp/components/index.js";
import { buildSessionSummaryFromCold } from "$lib/acp/application/dto/session-summary.js";
import ProjectIconPickerDialog from "$lib/acp/components/project-icon-picker-dialog.svelte";
import type { SessionListItem } from "$lib/acp/components/session-list/session-list-types.js";
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import { DEFAULT_BROWSER_HOME_URL } from "$lib/acp/constants/browser-defaults.js";
import { LOGGER_IDS } from "$lib/acp/constants/logger-ids.js";
import type { Project, ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import {
	getAgentPreferencesStore,
	getAgentStore,
	getInteractionStore,
	getPanelStore,
	getSessionStore,
	getUnseenStore,
} from "$lib/acp/store/index.js";
import {
	selectAttentionKind,
	type SessionAttentionEntry,
} from "$lib/acp/store/session-attention/index.js";
import { selectActiveSessions } from "$lib/acp/application/dto/session-archive.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { useTheme } from "$lib/components/theme/index.js";
import { backendClient } from "$lib/utils/backend-client/index.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import { applyCompletionAttentionAction } from "../../logic/completion-acknowledgement.js";
import type { UpdaterBannerState } from "../../logic/updater-state.js";
import { ensureProjectHeaderAgentSelected, getProjectHeaderAgents } from "./app-sidebar-agents.js";
import { removeProjectFromSidebar } from "./app-sidebar-remove-project.js";

import SidebarFooter from "./sidebar-footer.svelte";
import { buildSessionTranscriptFileDialogTarget } from "./session-transcript-file-dialog.js";

const logger = createLogger({
	id: LOGGER_IDS.MAIN_PAGE,
	name: "App Sidebar",
});

interface Props {
	projectManager: ProjectManager;
	state: MainAppViewState;
	updaterState?: UpdaterBannerState;
	onUpdateClick?: () => void;
	onRetryUpdateClick?: () => void;
}

let {
	projectManager,
	state: appState,
	updaterState,
	onUpdateClick,
	onRetryUpdateClick,
}: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const interactionStore = getInteractionStore();
const unseenStore = getUnseenStore();
const agentPreferencesStore = getAgentPreferencesStore();
const agentStore = getAgentStore();
const themeState = useTheme();

const attentionBySessionId = $derived.by(() => {
	const map = new Map<string, SessionAttentionEntry>();

	for (const panel of panelStore.panels) {
		const sessionId = panel.sessionId;
		if (sessionId === null) {
			continue;
		}

		const presentation = sessionStore.presentation.getSessionListItemPresentation({
			sessionId,
			interactionStore,
			hasUnseenCompletion: unseenStore.isUnseen(panel.id),
			active: true,
		});
		const kind = selectAttentionKind(presentation.sessionWorkProjection);
		if (kind === null) {
			continue;
		}

		map.set(sessionId, {
			kind,
			panelId: panel.id,
		});
	}

	return map;
});

function handleSelectSession(sessionId: string, sessionInfo?: SessionListItem) {
	const attention = attentionBySessionId.get(sessionId);
	void Effect.runPromise(
		appState
			.handleSelectSession(sessionId, sessionInfo)
			.pipe(Effect.catch(() => Effect.succeed(undefined)))
	);
	if (attention !== undefined) {
		applyCompletionAttentionAction(unseenStore, attention.panelId, {
			kind: "explicit-reveal",
		});
	}
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

			void Effect.runPromise(
				agentPreferencesStore.setSelectedAgentIds(nextSelectedAgentIds).pipe(
					Effect.match({
						onSuccess: () => undefined,
						onFailure: (error) => {
							toast.error(error.message);
							logger.error("[ProjectHeaderAgents] Failed to persist selected agents", {
								agentId,
								error,
								projectPath,
							});
						},
					})
				)
			);
		}
	}

	appState.handleNewThreadForProject(projectPath, agentId);
}

function handleProjectColorChange(projectPath: string, color: string) {
	void Effect.runPromise(
		projectManager.updateProjectColor(projectPath, color).pipe(
			Effect.catch((error) => {
				toast.error(`Failed to update project color: ${error.message}`);
				logger.error("[ProjectColor] Failed to update", { projectPath, color, error });
				return Effect.void;
			})
		)
	);
}

function handleToggleShowExternalCliSessions(
	projectPath: string,
	showExternalCliSessions: boolean
) {
	void Effect.runPromise(
		projectManager.updateProjectShowExternalCliSessions(projectPath, showExternalCliSessions).pipe(
			Effect.catch((error) => {
				toast.error(`Failed to update session visibility: ${error.message}`);
				logger.error("[ProjectVisibility] Failed to update external CLI visibility", {
					projectPath,
					showExternalCliSessions,
					error,
				});
				return Effect.void;
			})
		)
	);
}

function handleChangeProjectIcon(projectPath: string) {
	void Effect.runPromise(
		projectManager.listProjectImages(projectPath).pipe(
			Effect.match({
				onSuccess: (images) => {
					iconPickerProjectPath = projectPath;
					iconPickerImages = images;
					iconPickerOpen = true;
				},
				onFailure: (error) => {
					toast.error(`Failed to load project images: ${error.message}`);
					logger.error("[ProjectIcon] Failed to list project images", { projectPath, error });
				},
			})
		)
	);
}

function handleResetProjectIcon(projectPath: string) {
	void Effect.runPromise(
		projectManager.updateProjectIcon(projectPath, null).pipe(
			Effect.catch((error) => {
				toast.error(`Failed to reset project icon: ${error.message}`);
				logger.error("[ProjectIcon] Failed to reset", { projectPath, error });
				return Effect.void;
			})
		)
	);
}

function handleRemoveProject(projectPath: string) {
	void Effect.runPromise(
		removeProjectFromSidebar({
			projectPath,
			openSessionIds: sessionStore.read.getSessionIdsForProject(projectPath),
			panels: panelStore,
			removeProject: (path) => projectManager.removeProject(path),
			onFailure: (error) => {
				toast.error(`Failed to remove project: ${error.message}`);
				logger.error("[RemoveProject] Failed to remove", { projectPath, error });
			},
		})
	);
}

function handleSelectFile(filePath: string, projectPath: string) {
	panelStore.openFilePanel(filePath, projectPath);
}

function handleOpenTerminal(projectPath: string) {
	panelStore.toggleTerminalPanel(projectPath);
}

function handleOpenBrowser(projectPath: string) {
	panelStore.openBrowserPanel(projectPath, DEFAULT_BROWSER_HOME_URL, "acepe.dev");
}

function openTranscriptFileDialog(fullPath: string): void {
	const target = buildSessionTranscriptFileDialogTarget(fullPath);
	if (target === null) {
		toast.error("Failed to open transcript in Acepe: invalid transcript path");
		return;
	}

	panelStore.openProjectFileSystemDialog(target.projectPath, target.filePath, {
		projectName: target.projectName,
		title: "Session transcript",
	});
}

async function handleOpenTranscriptInAcepe(session: SessionDisplayItem) {
	const sourcePath = session.sourcePath?.trim();
	if (sourcePath) {
		openTranscriptFileDialog(sourcePath);
		return;
	}

	await Effect.runPromise(
		backendClient.shell.getSessionFilePath(session.id, session.projectPath).pipe(
			Effect.match({
				onSuccess: (path) => openTranscriptFileDialog(path),
				onFailure: (error) => toast.error(`Failed to open transcript in Acepe: ${error.message}`),
			})
		)
	);
}

function handleRenameSession(sessionInfo: SessionListItem, title: string) {
	void Effect.runPromise(
		sessionStore.write.renameSession(sessionInfo.id, title).pipe(
			Effect.match({
				onSuccess: () => undefined,
				onFailure: (error) => {
					toast.error(`Failed to rename session: ${error.message}`);
					logger.error("[RenameSession] Failed", {
						sessionId: sessionInfo.id,
						projectPath: sessionInfo.projectPath,
						title,
						error,
					});
				},
			})
		)
	);
}

function handleCopyTranscriptMarkdown(sessionId: string) {
	Result.match(sessionStore.read.getSessionMarkdownExportContent(sessionId), {
		onSuccess: (markdown) => {
			void Effect.runPromise(
				copyTextToClipboard(markdown).pipe(
					Effect.match({
						onSuccess: () => toast.success("Copied to clipboard"),
						onFailure: (err) => {
							toast.error(`Failed to copy transcript: ${err.message}`);
							logger.error("[CopyTranscriptMarkdown] Failed", { sessionId, error: err });
						},
					})
				)
			);
		},
		onFailure: (error) => toast.error(`Failed to copy transcript: ${error.message}`),
	});
}

function handleCopyTranscriptJson(sessionId: string) {
	Result.match(sessionStore.read.getSessionJsonExportContent(sessionId), {
		onSuccess: (content) => {
			void Effect.runPromise(
				copyTextToClipboard(content).pipe(
					Effect.match({
						onSuccess: () => toast.success("Copied to clipboard"),
						onFailure: (err) => {
							toast.error(`Failed to copy transcript: ${err.message}`);
							logger.error("[CopyTranscriptJson] Failed", { sessionId, error: err });
						},
					})
				)
			);
		},
		onFailure: (error) => toast.error(`Failed to copy transcript: ${error.message}`),
	});
}

// Archiving dispatches the canonical command and then re-reads the library
// projection, so the row leaves the list because `archivedAt` is set on the
// backend -- not because the client hid it. The same read is what makes the
// session stay gone after a restart.
async function handleArchiveSession(session: SessionDisplayItem) {
	await Effect.runPromise(
		backendClient.acp.archiveSession(session.id).pipe(
			Effect.flatMap(() => sessionStore.loading.scanSessionProjections()),
			Effect.match({
				onSuccess: () => {
					toast.success("Session archived");
				},
				onFailure: (error) => {
					toast.error(`Failed to archive session: ${error.message}`);
					logger.error("[ArchiveSession] Failed", { sessionId: session.id, error });
				},
			})
		)
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
const defaultAgentId = $derived(agentPreferencesStore.defaultAgentId);

let iconPickerOpen = $state(false);
let iconPickerImages = $state<string[]>([]);
let iconPickerProjectPath = $state("");
let reorderInFlight = $state(false);

function handleIconPickerOpenChange(open: boolean) {
	iconPickerOpen = open;
	if (!open) {
		iconPickerImages = [];
		iconPickerProjectPath = "";
	}
}

// The projection owns the order. Nothing is reordered here before the write
// lands: an optimistic local rank is a second authority for the same fact, and
// it was the thing that made a failed move snap back.
function handleReorderProjects(orderedPaths: string[]) {
	if (reorderInFlight) {
		return;
	}

	reorderInFlight = true;

	void Effect.runPromise(
		projectManager.updateProjectOrder(orderedPaths).pipe(
			Effect.match({
				onSuccess: () => {
					reorderInFlight = false;
				},
				onFailure: (error) => {
					reorderInFlight = false;
					toast.error(`Failed to reorder projects: ${error.message}`);
					logger.error("[ProjectReorder] Failed to persist project order", {
						error,
						orderedPaths,
					});
				},
			})
		)
	);
}

function handleSelectProjectIcon(iconPath: string) {
	const projectPath = iconPickerProjectPath;
	if (!projectPath) {
		return;
	}

	void Effect.runPromise(
		projectManager.updateProjectIcon(projectPath, iconPath).pipe(
			Effect.match({
				onSuccess: () => undefined,
				onFailure: (error) => {
					toast.error(`Failed to update project icon: ${error.message}`);
					logger.error("[ProjectIcon] Failed to change", { projectPath, error });
				},
			})
		)
	);
}

function handleBrowseProjectIcon() {
	const projectPath = iconPickerProjectPath;
	handleIconPickerOpenChange(false);
	if (!projectPath) {
		return;
	}

	void Effect.runPromise(
		projectManager.browseAndSetProjectIcon(projectPath).pipe(
			Effect.catch((error) => {
				toast.error(`Failed to update project icon: ${error.message}`);
				logger.error("[ProjectIcon] Failed to change", { projectPath, error });
				return Effect.void;
			})
		)
	);
}

// Performance: Only read canonical projection summary state here.
// Do NOT read compatibility transcript entries here; they change every rAF during streaming,
// marking this derived dirty on every frame and cascading to ALL SessionItem components.
const visibleSessions = $derived.by(() => {
	const coldSessions = agentPreferencesStore.filterItemsBySelectedAgents(
		sessionStore.read.getAllSessions()
	);
	return selectActiveSessions(coldSessions).map((cold) => {
		const listState = sessionStore.read.getSessionListState(cold.id);
		return buildSessionSummaryFromCold({
			cold,
			listState,
			entryCount: 0,
		});
	});
});
</script>

<AppSidebarLayout>
	{#snippet sessionList()}
		<SessionList
			sessions={visibleSessions}
			loading={sessionStore.sessionsLoading}
			scanningProjectPaths={sessionStore.scanningProjectPaths}
			recentProjects={projectManager.projects}
			canCreateSession={projectManager.projectCount !== null && projectManager.projectCount > 0}
			initialCollapsedProjectPaths={appState.collapsedProjectPaths}
			attentionBySessionId={attentionBySessionId}
			onSelectSession={handleSelectSession}
			onCreateSession={handleNewThread}
			onCreateSessionForProject={handleCreateSession}
			{availableAgents}
			{defaultAgentId}
			{effectiveTheme}
			onProjectColorChange={handleProjectColorChange}
			onChangeProjectIcon={handleChangeProjectIcon}
			onResetProjectIcon={handleResetProjectIcon}
			onRemoveProject={handleRemoveProject}
			isSessionOpen={(sessionId) => panelStore.isSessionOpen(sessionId)}
			onSelectFile={handleSelectFile}
			onCollapsedProjectPathsChange={(paths) => appState.handleCollapsedProjectPathsChange(paths)}
			onArchiveSession={handleArchiveSession}
			onRenameSession={handleRenameSession}
			onCopyTranscriptMarkdown={handleCopyTranscriptMarkdown}
			onCopyTranscriptJson={handleCopyTranscriptJson}
			onOpenTranscriptInAcepe={handleOpenTranscriptInAcepe}
			onReorderProjects={handleReorderProjects}
			onToggleShowExternalCliSessions={handleToggleShowExternalCliSessions}
		/>
	{/snippet}

	{#snippet footer()}
		<SidebarFooter
			{projectManager}
			state={appState}
			{updaterState}
			{onUpdateClick}
			{onRetryUpdateClick}
		/>
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
