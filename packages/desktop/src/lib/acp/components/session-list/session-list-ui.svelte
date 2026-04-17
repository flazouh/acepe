<script lang="ts">
import { DiffPill } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import { IconArrowDown } from "@tabler/icons-svelte";
import { IconArrowUp } from "@tabler/icons-svelte";
import { IconPlus } from "@tabler/icons-svelte";
import { listen } from "@tauri-apps/api/event";
import { DropdownMenu } from "bits-ui";
import { ArrowsClockwise } from "phosphor-svelte";
import { ArrowDown } from "phosphor-svelte";
import { ArrowCounterClockwise } from "phosphor-svelte";
import { ArrowUp } from "phosphor-svelte";
import { BookOpen } from "phosphor-svelte";
import { Browser } from "phosphor-svelte";
import { Bug } from "phosphor-svelte";
import { Check } from "phosphor-svelte";
import { GitBranch } from "phosphor-svelte";
import { ImageSquare } from "phosphor-svelte";
import { MagnifyingGlass } from "phosphor-svelte";
import { Recycle } from "phosphor-svelte";
import { Sparkle } from "phosphor-svelte";
import { Terminal } from "phosphor-svelte";
import { TestTube } from "phosphor-svelte";
import { Wrench } from "phosphor-svelte";
import type { Component } from "svelte";
import { tick } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import { Button, buttonVariants } from "$lib/components/ui/button/index.js";
import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Label } from "$lib/components/ui/label/index.js";
import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
import {
	ProjectCardSkeleton,
	SessionListSkeleton,
	Skeleton,
} from "$lib/components/ui/skeleton/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/messages.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import type { GitRemoteStatus } from "$lib/utils/tauri-client/git.js";
import { revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
import type { AgentInfo } from "../../logic/agent-manager.js";
import { createFileTree, flattenFileTree } from "../file-list/file-list-logic.js";
import type { FileTreeNode } from "../file-list/file-list-types.js";
import FileTreeItem from "../file-list/file-tree-item.svelte";
import ProjectHeader from "../project-header.svelte";
import ProjectHeaderOverflowMenu from "../project-header-overflow-menu.svelte";
import {
	getSidebarSessions,
	getNextSessionListVisibleCount,
	getSessionListVisibleCount,
	isSessionListNearBottom,
	resolveDefaultAgentIdForCreate,
} from "./session-list-logic.js";
import type { SessionGroup, SessionListItem } from "./session-list-types.js";
import VirtualizedSessionList from "./virtualized-session-list.svelte";

type ProjectViewMode = "sessions" | "files";

interface Props {
	sessionGroups: SessionGroup[];
	hasResults: boolean;
	loading: boolean;
	scanningProjectPaths?: ReadonlySet<string>;
	totalCount: number;
	hasProjects?: boolean;
	selectedSessionId?: string | null;
	canCreateSession?: boolean;
	shortcutKeys?: string[];
	scanning?: boolean;
	/** Initial file tree expansion state (projectPath -> expanded folder paths) */
	initialFileTreeExpansion?: Record<string, string[]>;
	/** Initial project file view modes (projectPath -> "sessions" | "files") */
	initialProjectFileViewModes?: Record<string, "sessions" | "files">;
	/** Initial collapsed project paths for persistence */
	initialCollapsedProjectPaths?: string[];
	onProjectColorChange?: (projectPath: string, color: string) => void;
	onChangeProjectIcon?: (projectPath: string) => void;
	onResetProjectIcon?: (projectPath: string) => void;
	onRemoveProject?: (projectPath: string) => void;
	onSelectSession: (item: SessionListItem) => void;
	onCreateSession?: () => void;
	onCreateSessionForProject?: (projectPath: string, agentId?: string) => void;
	/** Available agents for session creation */
	availableAgents?: AgentInfo[];
	/**
	 * Default agent id to spawn on a plain left-click of the `+` button.
	 */
	defaultAgentId?: string | null;
	/** Current theme for agent icons */
	effectiveTheme?: "light" | "dark";
	onProjectClick?: (projectPath: string) => void;
	onSelectFile?: (filePath: string, projectPath: string) => void;
	/** Called when file tree expansion state changes (for persistence) */
	onFileTreeExpansionChange?: (expansion: Record<string, string[]>) => void;
	/** Called when project file view mode changes (for persistence) */
	onProjectFileViewModeChange?: (modes: Record<string, "sessions" | "files">) => void;
	/** Called when collapsed project paths change (for persistence) */
	onCollapsedProjectPathsChange?: (paths: string[]) => void;
	/** Called when terminal button is clicked for a project */
	onOpenTerminal?: (projectPath: string) => void;
	/** Called when browser button is clicked for a project */
	onOpenBrowser?: (projectPath: string) => void;
	/** Called when git panel button is clicked for a project */
	onOpenGitPanel?: (projectPath: string) => void;
	/** Called when PR badge is clicked on a session row */
	onOpenPr?: (item: SessionListItem) => void;
	/** Called when user archives a session from the sidebar */
	onArchiveSession?: (session: SessionDisplayItem) => void | Promise<void>;
	/** Called when user renames a session from the sidebar */
	onRenameSession?: (session: SessionListItem, title: string) => void | Promise<void>;
	/** Called when user exports session as markdown */
	onExportMarkdown?: (sessionId: string) => void | Promise<void>;
	/** Called when user exports session as JSON */
	onExportJson?: (sessionId: string) => void | Promise<void>;
	/** Called when project order changes from the sidebar move actions */
	onReorderProjects?: (orderedPaths: string[]) => void;
}

let {
	sessionGroups,
	loading,
	scanningProjectPaths = new Set(),
	hasProjects: _hasProjects = true,
	selectedSessionId = null,
	canCreateSession: _canCreateSession = false,
	shortcutKeys: _shortcutKeys = ["⌘", "N"],
	scanning = false,
	initialFileTreeExpansion = {},
	initialProjectFileViewModes = {},
	initialCollapsedProjectPaths = [],
	onProjectColorChange,
	onChangeProjectIcon,
	onResetProjectIcon,
	onRemoveProject,
	onSelectSession,
	onCreateSession: _onCreateSession,
	onCreateSessionForProject,
	availableAgents = [],
	defaultAgentId = null,
	effectiveTheme = "light",
	onProjectClick,
	onSelectFile,
	onFileTreeExpansionChange,
	onProjectFileViewModeChange,
	onCollapsedProjectPathsChange,
	onOpenTerminal,
	onOpenBrowser,
	onOpenGitPanel,
	onOpenPr,
	onArchiveSession,
	onRenameSession,
	onExportMarkdown,
	onExportJson,
	onReorderProjects,
}: Props = $props();

// Project collapse state (hydrated from persisted state in one-time effect)
const collapsedProjects = new SvelteSet<string>();
const expandedProjects = $derived(
	new Set(
		sessionGroups.map((group) => group.projectPath).filter((path) => !collapsedProjects.has(path))
	)
);
const projectHeaderFocusTargets = new Map<string, HTMLDivElement>();
let reorderAnnouncement = $state("");

// Per-project files state
const filesByProject = new SvelteMap<string, FileTreeNode[]>();
const loadingFilesProjects = new SvelteSet<string>();
const filesErrorByProject = new SvelteMap<string, string>();

// Expanded folders (hydrated from persisted state in one-time effect)
const expandedFolders = new SvelteSet<string>();

// Per-project view mode (hydrated from persisted state in one-time effect)
const projectViewModes = new SvelteMap<string, ProjectViewMode>();
const visibleSessionCounts = new SvelteMap<string, number>();
const sessionListContainers = new Map<string, HTMLDivElement>();

function shouldShowProjectUtilityActions(): boolean {
	return Boolean(onOpenTerminal) || Boolean(onOpenBrowser);
}

function shouldShowProjectCreateButton(): boolean {
	return Boolean(onCreateSessionForProject);
}

let initialStateHydrated = false;
$effect(() => {
	if (initialStateHydrated) return;
	initialStateHydrated = true;

	for (const path of initialCollapsedProjectPaths ?? []) {
		collapsedProjects.add(path);
	}

	for (const [projectPath, folderPaths] of Object.entries(initialFileTreeExpansion ?? {})) {
		for (const folderPath of folderPaths) {
			expandedFolders.add(`${projectPath}:${folderPath}`);
		}
	}

	for (const [projectPath, mode] of Object.entries(initialProjectFileViewModes ?? {})) {
		projectViewModes.set(projectPath, mode);
		if (mode === "files") {
			// Deferred to after loadProjectFiles is defined (function is hoisted)
			queueMicrotask(() => loadProjectFiles(projectPath));
		}
	}
});

// Sync collapsed state when initialCollapsedProjectPaths changes (e.g. after workspace restore).
// Restore runs async after mount, so the one-time effect above may run with [] before restore applies.
$effect(() => {
	const paths = initialCollapsedProjectPaths ?? [];
	collapsedProjects.clear();
	for (const path of paths) {
		collapsedProjects.add(path);
	}
});

$effect(() => {
	const activeProjectPaths = new Set<string>();
	for (const group of sessionGroups) {
		activeProjectPaths.add(group.projectPath);
		const normalizedVisibleCount = getSessionListVisibleCount(
			group.sessions.length,
			visibleSessionCounts.get(group.projectPath)
		);
		if (visibleSessionCounts.get(group.projectPath) !== normalizedVisibleCount) {
			visibleSessionCounts.set(group.projectPath, normalizedVisibleCount);
		}
	}

	for (const projectPath of visibleSessionCounts.keys()) {
		if (!activeProjectPaths.has(projectPath)) {
			visibleSessionCounts.delete(projectPath);
			sessionListContainers.delete(projectPath);
		}
	}
});

// Rename dialog

// New file / New folder dialogs
let newFileDialogOpen = $state(false);
let newFileData = $state<{ projectPath: string; parentRelativePath: string } | null>(null);
let newFileInput = $state("");

let newFolderDialogOpen = $state(false);
let newFolderData = $state<{ projectPath: string; parentRelativePath: string } | null>(null);
let newFolderInput = $state("");

function getProjectViewMode(projectPath: string): ProjectViewMode {
	return projectViewModes.get(projectPath) ?? "sessions";
}

function toggleProject(projectPath: string) {
	if (collapsedProjects.has(projectPath)) {
		collapsedProjects.delete(projectPath);
	} else {
		collapsedProjects.add(projectPath);
		if (openBranchPickerProject === projectPath) {
			openBranchPickerProject = null;
		}
	}
	notifyCollapsedProjectPathsChange();
}

function notifyCollapsedProjectPathsChange(): void {
	onCollapsedProjectPathsChange?.(Array.from(collapsedProjects));
}

function registerProjectHeaderFocusTarget(projectPath: string, node: HTMLDivElement | null): void {
	if (node === null) {
		projectHeaderFocusTargets.delete(projectPath);
		return;
	}

	projectHeaderFocusTargets.set(projectPath, node);
}

function projectHeaderFocusTarget(
	node: HTMLDivElement,
	projectPath: string
): { update: (nextProjectPath: string) => void; destroy: () => void } {
	let currentProjectPath = projectPath;
	registerProjectHeaderFocusTarget(currentProjectPath, node);

	return {
		update(nextProjectPath: string): void {
			if (nextProjectPath === currentProjectPath) {
				return;
			}

			projectHeaderFocusTargets.delete(currentProjectPath);
			currentProjectPath = nextProjectPath;
			registerProjectHeaderFocusTarget(currentProjectPath, node);
		},
		destroy(): void {
			projectHeaderFocusTargets.delete(currentProjectPath);
		},
	};
}

function setProjectViewMode(projectPath: string, mode: ProjectViewMode) {
	const currentMode = getProjectViewMode(projectPath);
	if (currentMode === mode) return;

	projectViewModes.set(projectPath, mode);
	notifyProjectViewModeChange();

	if (
		mode === "files" &&
		!filesByProject.has(projectPath) &&
		!loadingFilesProjects.has(projectPath)
	) {
		loadProjectFiles(projectPath);
	}
}

function getVisibleSessionsForProject(group: SessionGroup): SessionListItem[] {
	const sidebarSessions = getSidebarSessions(group.sessions);
	const visibleCount = getSessionListVisibleCount(
		sidebarSessions.length,
		visibleSessionCounts.get(group.projectPath)
	);
	return sidebarSessions.slice(0, visibleCount);
}

function ensureSessionListOverflow(projectPath: string, totalSessions: number): void {
	const container = sessionListContainers.get(projectPath);
	if (!container) {
		return;
	}

	if (!isSessionListNearBottom(container.scrollTop, container.clientHeight, container.scrollHeight)) {
		return;
	}

	const currentVisibleCount = getSessionListVisibleCount(
		totalSessions,
		visibleSessionCounts.get(projectPath)
	);
	const nextVisibleCount = getNextSessionListVisibleCount(
		totalSessions,
		visibleSessionCounts.get(projectPath)
	);
	if (currentVisibleCount === nextVisibleCount) {
		return;
	}

	visibleSessionCounts.set(projectPath, nextVisibleCount);
	requestAnimationFrame(() => {
		ensureSessionListOverflow(projectPath, totalSessions);
	});
}

function registerSessionListContainer(
	projectPath: string,
	totalSessions: number,
	node: HTMLDivElement | null
): void {
	if (node === null) {
		sessionListContainers.delete(projectPath);
		return;
	}

	sessionListContainers.set(projectPath, node);
	requestAnimationFrame(() => {
		ensureSessionListOverflow(projectPath, totalSessions);
	});
}

function sessionListContainer(
	node: HTMLDivElement,
	params: { projectPath: string; totalSessions: number }
): { update: (nextParams: { projectPath: string; totalSessions: number }) => void; destroy: () => void } {
	registerSessionListContainer(params.projectPath, params.totalSessions, node);

	return {
		update(nextParams) {
			if (nextParams.projectPath !== params.projectPath) {
				registerSessionListContainer(params.projectPath, params.totalSessions, null);
			}
			params = nextParams;
			registerSessionListContainer(params.projectPath, params.totalSessions, node);
		},
		destroy() {
			registerSessionListContainer(params.projectPath, params.totalSessions, null);
		},
	};
}

function handleSessionListScroll(projectPath: string, totalSessions: number): void {
	ensureSessionListOverflow(projectPath, totalSessions);
}

/**
 * Notify parent of project view mode changes for persistence.
 */
function notifyProjectViewModeChange() {
	if (!onProjectFileViewModeChange) return;

	const result: Record<string, "sessions" | "files"> = {};
	for (const [projectPath, mode] of projectViewModes) {
		// Only persist projects with "files" view (default is sessions)
		if (mode === "files") {
			result[projectPath] = mode;
		}
	}
	onProjectFileViewModeChange(result);
}

function loadProjectFiles(projectPath: string): void {
	loadingFilesProjects.add(projectPath);
	filesErrorByProject.delete(projectPath);

	tauriClient.fileIndex
		.getProjectFiles(projectPath)
		.mapErr((e) => new Error(String(e)))
		.match(
			(result) => {
				const tree = createFileTree(result.files);
				filesByProject.set(projectPath, tree);
				loadingFilesProjects.delete(projectPath);
			},
			(error) => {
				filesErrorByProject.set(projectPath, error.message);
				loadingFilesProjects.delete(projectPath);
			}
		);
}

function toggleFolder(projectPath: string, folderPath: string) {
	const key = `${projectPath}:${folderPath}`;
	if (expandedFolders.has(key)) {
		expandedFolders.delete(key);
	} else {
		expandedFolders.add(key);
	}
	notifyExpansionChange();
}

/**
 * Notify parent of expansion state change for persistence.
 */
function notifyExpansionChange() {
	if (!onFileTreeExpansionChange) return;

	const result: Record<string, string[]> = {};
	for (const key of expandedFolders) {
		const colonIndex = key.indexOf(":");
		if (colonIndex === -1) continue;
		const projectPath = key.substring(0, colonIndex);
		const folderPath = key.substring(colonIndex + 1);
		if (!result[projectPath]) {
			result[projectPath] = [];
		}
		result[projectPath].push(folderPath);
	}
	onFileTreeExpansionChange(result);
}

function handleFileSelect(filePath: string, projectPath: string) {
	onSelectFile?.(filePath, projectPath);
}

function handleRevealInFinder(fullPath: string) {
	revealInFinder(fullPath).match(
		() => {},
		() => toast.error(m.file_panel_open_in_finder_error())
	);
}

function handleRefreshFileTree(projectPath: string) {
	tauriClient.fileIndex
		.invalidateProjectFiles(projectPath)
		.mapErr((e) => new Error(String(e)))
		.match(
			() => loadProjectFiles(projectPath),
			() => {
				// Still try to reload
				loadProjectFiles(projectPath);
			}
		);
}

function handleDeleteConfirm(projectPath: string, relativePath: string) {
	tauriClient.fileIndex
		.deletePath(projectPath, relativePath)
		.mapErr((e) => new Error(String(e)))
		.match(
			() => handleRefreshFileTree(projectPath),
			(err) => toast.error(m.file_list_delete_error({ error: err.message }))
		);
}

function handleRenameConfirm(projectPath: string, relativePath: string, newName: string) {
	const parent = relativePath.includes("/") ? relativePath.replace(/\/[^/]+$/, "") : "";
	const toRelative = parent ? `${parent}/${newName}` : newName;

	tauriClient.fileIndex
		.renamePath(projectPath, relativePath, toRelative)
		.mapErr((e) => new Error(String(e)))
		.match(
			() => handleRefreshFileTree(projectPath),
			(err) => toast.error(m.file_list_rename_error({ error: err.message }))
		);
}

function handleDuplicateRequest(projectPath: string, relativePath: string) {
	tauriClient.fileIndex
		.copyFile(projectPath, relativePath)
		.mapErr((e) => new Error(String(e)))
		.match(
			() => handleRefreshFileTree(projectPath),
			(err) => toast.error(m.file_list_duplicate_error({ error: err.message }))
		);
}

function handleNewFileRequest(projectPath: string, parentRelativePath: string) {
	newFileData = { projectPath, parentRelativePath };
	newFileInput = "";
	newFileDialogOpen = true;
}

function handleNewFileSubmit() {
	const data = newFileData;
	if (!data || !newFileInput.trim()) return;
	const relativePath = data.parentRelativePath
		? `${data.parentRelativePath}/${newFileInput.trim()}`
		: newFileInput.trim();
	newFileDialogOpen = false;
	newFileData = null;

	tauriClient.fileIndex
		.createFile(data.projectPath, relativePath)
		.mapErr((e) => new Error(String(e)))
		.match(
			() => handleRefreshFileTree(data.projectPath),
			(err) => toast.error(m.file_list_new_file_error({ error: err.message }))
		);
}

function handleNewFolderRequest(projectPath: string, parentRelativePath: string) {
	newFolderData = { projectPath, parentRelativePath };
	newFolderInput = "";
	newFolderDialogOpen = true;
}

function handleNewFolderSubmit() {
	const data = newFolderData;
	if (!data || !newFolderInput.trim()) return;
	const relativePath = data.parentRelativePath
		? `${data.parentRelativePath}/${newFolderInput.trim()}`
		: newFolderInput.trim();
	newFolderDialogOpen = false;
	newFolderData = null;

	tauriClient.fileIndex
		.createDirectory(data.projectPath, relativePath)
		.mapErr((e) => new Error(String(e)))
		.match(
			() => handleRefreshFileTree(data.projectPath),
			(err) => toast.error(m.file_list_new_folder_error({ error: err.message }))
		);
}

function getFlattenedFiles(
	projectPath: string
): Array<{ node: FileTreeNode; projectPath: string }> {
	const files = filesByProject.get(projectPath) ?? [];
	return flattenFileTree(files, expandedFolders, projectPath);
}

// ─── Git overview state (per-project) ──────────────────────────────
type GitOverviewData = {
	branch: string | null;
	gitStatus: ReadonlyArray<FileGitStatus> | null;
	remoteStatus: GitRemoteStatus | null;
};
const gitDataByProject = new SvelteMap<string, GitOverviewData>();
const gitLoadedProjects = new SvelteSet<string>();
const nonGitProjects = new SvelteSet<string>();
const fetchingProjects = new SvelteSet<string>();
const pullingProjects = new SvelteSet<string>();
const gitOverviewRequestVersionByProject = new Map<string, number>();
let initializingGitProject = $state<string | null>(null);

function loadGitOverview(projectPath: string) {
	if (gitLoadedProjects.has(projectPath)) return;
	const requestVersion = (gitOverviewRequestVersionByProject.get(projectPath) ?? 0) + 1;
	gitOverviewRequestVersionByProject.set(projectPath, requestVersion);

	void tauriClient.git.isRepo(projectPath).match(
		(isRepo) => {
			if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
				return;
			}

			if (!isRepo) {
				gitLoadedProjects.delete(projectPath);
				gitDataByProject.delete(projectPath);
				nonGitProjects.add(projectPath);
				return;
			}

			gitLoadedProjects.add(projectPath);
			void tauriClient.fileIndex.getProjectGitOverviewSummary(projectPath).match(
				(overview) => {
					if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
						return;
					}

					nonGitProjects.delete(projectPath);
					gitDataByProject.set(projectPath, {
						branch: overview.branch,
						gitStatus: overview.gitStatus,
						remoteStatus: null,
					});
					// Also load remote status
					void tauriClient.git.remoteStatus(projectPath).match(
						(status) => {
							if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
								return;
							}

							const current = gitDataByProject.get(projectPath);
							if (current) {
								gitDataByProject.set(projectPath, {
									branch: current.branch,
									gitStatus: current.gitStatus,
									remoteStatus: status,
								});
							}
						},
						() => {}
					);
				},
				() => {
					if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
						return;
					}

					gitLoadedProjects.delete(projectPath);
					gitDataByProject.delete(projectPath);
					nonGitProjects.add(projectPath);
				}
			);
		},
		() => {
			if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
				return;
			}

			gitLoadedProjects.delete(projectPath);
			gitDataByProject.delete(projectPath);
			nonGitProjects.add(projectPath);
		}
	);
}

function handleInitGitRepo(event: MouseEvent, projectPath: string): void {
	event.stopPropagation();
	if (initializingGitProject) return;
	initializingGitProject = projectPath;
	void tauriClient.git.init(projectPath).match(
		() => {
			initializingGitProject = null;
			nonGitProjects.delete(projectPath);
			gitLoadedProjects.delete(projectPath);
			loadGitOverview(projectPath);
			toast.success("Git repository initialized");
		},
		(error) => {
			const message =
				error.cause?.message ?? error.message ?? "Failed to initialize git repository";
			void tauriClient.git.isRepo(projectPath).match(
				(isRepo) => {
					initializingGitProject = null;
					if (isRepo) {
						nonGitProjects.delete(projectPath);
						gitLoadedProjects.delete(projectPath);
						loadGitOverview(projectPath);
						toast.success("Git repository initialized");
						return;
					}

					toast.error(message);
				},
				() => {
					initializingGitProject = null;
					toast.error(message);
				}
			);
		}
	);
}

function handleFetchRemote(event: MouseEvent, projectPath: string) {
	event.stopPropagation();
	if (fetchingProjects.has(projectPath)) return;
	fetchingProjects.add(projectPath);

	void tauriClient.git.fetch(projectPath).match(
		() => {
			void tauriClient.git.remoteStatus(projectPath).match(
				(status) => {
					const current = gitDataByProject.get(projectPath);
					if (current) {
						gitDataByProject.set(projectPath, { ...current, remoteStatus: status });
					}
					fetchingProjects.delete(projectPath);
				},
				() => {
					fetchingProjects.delete(projectPath);
				}
			);
		},
		() => {
			fetchingProjects.delete(projectPath);
		}
	);
}

function handlePullRemote(event: MouseEvent, projectPath: string) {
	event.stopPropagation();
	if (pullingProjects.has(projectPath)) return;
	pullingProjects.add(projectPath);

	void tauriClient.git.pull(projectPath).match(
		() => {
			gitLoadedProjects.delete(projectPath);
			loadGitOverview(projectPath);
			toast.success("Branch updated");
			pullingProjects.delete(projectPath);
		},
		(err) => {
			toast.error(err?.message ?? "Pull failed");
			pullingProjects.delete(projectPath);
		}
	);
}

// Load git overview for all projects on mount
$effect(() => {
	for (const group of sessionGroups) {
		loadGitOverview(group.projectPath);
	}
});

// Watch for external branch changes via .git/HEAD file watcher.
// Two separate effects: one subscribes to the event stream once (mount),
// the other dispatches watchHead only for newly-seen project paths.
// Prior implementation re-ran on every sessionGroups reference change and
// fired 6 IPC calls per tick (~30 calls in 58s observed in profiling).
const watchedProjectPaths = new Set<string>();

$effect(() => {
	let unlisten: (() => void) | null = null;
	let disposed = false;
	listen<{ projectPath: string; branch: string | null }>("git:head-changed", (event) => {
		const pp = event.payload.projectPath;
		if (gitLoadedProjects.has(pp)) {
			gitLoadedProjects.delete(pp);
			loadGitOverview(pp);
		}
	}).then((fn) => {
		if (disposed) fn();
		else unlisten = fn;
	});

	return () => {
		disposed = true;
		unlisten?.();
	};
});

$effect(() => {
	for (const group of sessionGroups) {
		const pp = group.projectPath;
		if (watchedProjectPaths.has(pp) || !gitDataByProject.has(pp)) continue;
		watchedProjectPaths.add(pp);
		void tauriClient.git.watchHead(pp).match(
			() => {},
			() => {}
		);
	}
});

function handleSessionSelect(item: SessionListItem) {
	onSelectSession(item);
}

function handleCreateClick(event: MouseEvent, projectPath: string, agentId?: string) {
	event.stopPropagation();
	onCreateSessionForProject?.(projectPath, agentId);
}

/**
 * Resolve the default agent id to use when the `+` button is left-clicked.
 * Returns undefined when there is no saved default, or when the saved default
 * is no longer present in `availableAgents` (e.g. the agent was removed or
 * disabled since it was saved).
 */
function resolveDefaultAgentIdForCreateLocal(): string | undefined {
	return resolveDefaultAgentIdForCreate(availableAgents, defaultAgentId);
}

function handleProjectCreateButtonClick(event: MouseEvent, projectPath: string) {
	event.stopPropagation();
	const resolvedDefault = resolveDefaultAgentIdForCreateLocal();
	handleCreateClick(event, projectPath, resolvedDefault);
}

/**
 * Primary tooltip label for the project `+` button. When a saved default agent
 * resolves, advertise that the left-click will spawn that agent directly; otherwise
 * keep the generic "New session in {projectName}" wording.
 */
function getProjectCreateButtonTooltipLabel(projectName: string): string {
	const resolvedDefaultId = resolveDefaultAgentIdForCreateLocal();
	if (resolvedDefaultId !== undefined) {
		const agent = availableAgents.find((a) => a.id === resolvedDefaultId);
		if (agent) {
			return m.thread_list_new_default_agent_session({
				agentName: agent.name,
				projectName,
			});
		}
	}
	return m.thread_list_new_session_in_project({ projectName });
}

function handleOpenGitPanel(event: MouseEvent, projectPath: string) {
	event.stopPropagation();
	onOpenGitPanel?.(projectPath);
}

const projectHeaderHoverActionButtonClass =
	"flex items-center justify-center size-5 rounded text-muted-foreground transition-all hover:bg-accent hover:text-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100";

function handleProjectHeaderClick(projectPath: string) {
	toggleProject(projectPath);
}

function getProjectGroupByPath(projectPath: string): SessionGroup | null {
	for (const group of sessionGroups) {
		if (group.projectPath === projectPath) {
			return group;
		}
	}

	return null;
}

function getCurrentProjectOrder(): string[] {
	const orderedPaths: string[] = [];
	for (const group of sessionGroups) {
		orderedPaths.push(group.projectPath);
	}

	return orderedPaths;
}

function isProjectOrderUnchanged(orderedPaths: string[]): boolean {
	if (orderedPaths.length !== sessionGroups.length) {
		return false;
	}

	for (let index = 0; index < orderedPaths.length; index += 1) {
		if (orderedPaths[index] !== sessionGroups[index]?.projectPath) {
			return false;
		}
	}

	return true;
}

function announceProjectReorder(projectPath: string, orderedPaths: string[]): void {
	const group = getProjectGroupByPath(projectPath);
	const position = orderedPaths.indexOf(projectPath);

	if (group === null || position < 0) {
		return;
	}

	reorderAnnouncement = "";
	queueMicrotask(() => {
		reorderAnnouncement = m.project_reorder_announcement({
			projectName: group.projectName,
			position: position + 1,
			total: orderedPaths.length,
		});
	});
}

function applyProjectOrder(projectPath: string, orderedPaths: string[]): void {
	if (onReorderProjects === undefined || isProjectOrderUnchanged(orderedPaths)) {
		return;
	}

	announceProjectReorder(projectPath, orderedPaths);
	onReorderProjects(orderedPaths);
}

function getMovedProjectOrder(projectPath: string, offset: -1 | 1): string[] | null {
	const orderedPaths = getCurrentProjectOrder();
	const currentIndex = orderedPaths.indexOf(projectPath);
	const nextIndex = currentIndex + offset;

	if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedPaths.length) {
		return null;
	}

	const currentPath = orderedPaths[currentIndex];
	const nextPath = orderedPaths[nextIndex];

	if (currentPath === undefined || nextPath === undefined) {
		return null;
	}

	orderedPaths[currentIndex] = nextPath;
	orderedPaths[nextIndex] = currentPath;

	return orderedPaths;
}

async function focusProjectContextTrigger(projectPath: string): Promise<void> {
	await tick();
	// V1 intentionally returns focus to the outer header wrapper instead of the bits-ui
	// ContextMenu.Trigger because the wrapper is reliably focusable and still supports
	// reopening the context menu with Shift+F10 for consecutive keyboard moves.
	projectHeaderFocusTargets.get(projectPath)?.focus();
}

async function handleProjectContextMove(projectPath: string, offset: -1 | 1): Promise<void> {
	const orderedPaths = getMovedProjectOrder(projectPath, offset);

	if (orderedPaths === null) {
		return;
	}

	applyProjectOrder(projectPath, orderedPaths);
	await focusProjectContextTrigger(projectPath);
}

// ─── Branch picker ───────────────────────────────────────────────

interface BranchPrefix {
	label: string;
	value: string;
	icon: Component;
	color: string;
}

const BRANCH_PREFIXES: BranchPrefix[] = [
	{ label: "None", value: "", icon: GitBranch, color: Colors.purple },
	{ label: "feat", value: "feat/", icon: Sparkle, color: "var(--success)" },
	{ label: "fix", value: "fix/", icon: Bug, color: Colors.red },
	{ label: "chore", value: "chore/", icon: Wrench, color: Colors.orange },
	{ label: "refactor", value: "refactor/", icon: Recycle, color: Colors.cyan },
	{ label: "docs", value: "docs/", icon: BookOpen, color: Colors.yellow },
	{ label: "test", value: "test/", icon: TestTube, color: Colors.pink },
];

let openBranchPickerProject = $state<string | null>(null);
let branchQuery = $state("");
let branches = $state<string[]>([]);
let loadingBranches = $state(false);
let switchingBranch = $state(false);
let branchInputRef = $state<HTMLInputElement | null>(null);
let branchLoadFailed = $state(false);

let createBranchDialogOpen = $state(false);
let createBranchProjectPath = $state<string | null>(null);
let newBranchName = $state("");
let selectedPrefix = $state(BRANCH_PREFIXES[0]);
let prefixDropdownOpen = $state(false);
let newBranchInputRef = $state<HTMLInputElement | null>(null);

const normalizedBranchQuery = $derived(branchQuery.trim().toLowerCase());
const filteredBranches = $derived.by(() => {
	if (!normalizedBranchQuery) return branches;
	return branches.filter((b) => b.toLowerCase().includes(normalizedBranchQuery));
});

const normalizedNewBranchName = $derived(newBranchName.trim());
const fullBranchName = $derived(selectedPrefix.value + normalizedNewBranchName);
const newBranchExists = $derived.by(() =>
	branches.some((b) => b.toLowerCase() === fullBranchName.toLowerCase())
);
const newBranchNameError = $derived.by(() => {
	if (normalizedNewBranchName.length === 0) return null;
	if (newBranchExists) return "Branch already exists";
	if (normalizedNewBranchName.endsWith("/")) return 'Branch name cannot end with "/"';
	if (normalizedNewBranchName.includes(" ")) return "Branch name cannot contain spaces";
	return null;
});
const canCreateBranch = $derived.by(() => {
	return normalizedNewBranchName.length > 0 && !newBranchNameError && !switchingBranch;
});

$effect(() => {
	const projectPath = openBranchPickerProject;
	if (!projectPath) {
		branchQuery = "";
		return;
	}
	queueMicrotask(() => branchInputRef?.focus());
	loadingBranches = true;
	branchLoadFailed = false;
	let cancelled = false;
	void tauriClient.git.listBranches(projectPath).match(
		(availableBranches) => {
			if (cancelled) return;
			branches = availableBranches;
			loadingBranches = false;
		},
		(error) => {
			if (cancelled) return;
			loadingBranches = false;
			branchLoadFailed = true;
			const message = error.cause?.message ?? error.message ?? "Failed to list branches";
			toast.error(message);
		}
	);
	return () => {
		cancelled = true;
	};
});

function handleSwitchBranch(projectPath: string, branch: string, create: boolean): void {
	if (switchingBranch) return;
	switchingBranch = true;
	void tauriClient.git.checkoutBranch(projectPath, branch, create).match(
		() => {
			switchingBranch = false;
			openBranchPickerProject = null;
			createBranchDialogOpen = false;
			gitLoadedProjects.delete(projectPath);
			loadGitOverview(projectPath);
		},
		(error) => {
			switchingBranch = false;
			const message = error.cause?.message ?? error.message ?? "Failed to switch branch";
			toast.error(message);
		}
	);
}

function handleCreateBranchSubmit(): void {
	if (!canCreateBranch || !createBranchProjectPath) return;
	handleSwitchBranch(createBranchProjectPath, fullBranchName, true);
}

function openCreateBranchDialog(projectPath: string): void {
	openBranchPickerProject = null;
	createBranchProjectPath = projectPath;
	newBranchName = "";
	selectedPrefix = BRANCH_PREFIXES[0];
	createBranchDialogOpen = true;
	queueMicrotask(() => newBranchInputRef?.focus());
}
</script>

<div
	class="relative flex h-full min-h-0 flex-col gap-2 overflow-y-auto outline-none"
	data-thread-list-scrollable
>
	{#if loading && !scanning && sessionGroups.every((g) => g.sessions.length === 0)}
		<!-- Initial loading (no sessions cached yet): real project headers + session list skeleton -->
		{#if sessionGroups.length > 0}
			<div class="flex flex-col flex-1 min-h-0 gap-0.5">
				{#each sessionGroups as group, projectIndex (group.projectPath)}
					{@const viewMode = getProjectViewMode(group.projectPath)}
					<div class="flex min-w-0 flex-col overflow-hidden rounded-md bg-card/75">
						<!-- Real project header (only sessions are loading) -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							use:projectHeaderFocusTarget={group.projectPath}
							class="shrink-0 flex items-center"
							role="button"
							tabindex={0}
							onclick={() => handleProjectHeaderClick(group.projectPath)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									handleProjectHeaderClick(group.projectPath);
								}
							}}
						>
							<ContextMenu.Root>
								<ContextMenu.Trigger class="flex-1 min-w-0">
									<ProjectHeader
										projectColor={group.projectColor}
										projectName={group.projectName}
										projectIconSrc={group.projectIconSrc}
										expanded={true}
										class="group min-w-0 flex-1 cursor-pointer transition-colors"
									>
										{#snippet actions()}
											<div
												class="flex items-center gap-0.5"
												role="presentation"
												onclick={(e) => e.stopPropagation()}
												onkeydown={(e) => e.stopPropagation()}
											>
												<ProjectHeaderOverflowMenu
													projectName={group.projectName}
													currentColor={group.projectColor}
													currentViewMode={viewMode}
													onColorChange={onProjectColorChange
														? (color) => onProjectColorChange(group.projectPath, color)
														: undefined}
													onViewModeChange={(mode) => setProjectViewMode(group.projectPath, mode)}
													projectIconSrc={group.projectIconSrc}
													onResetProjectIcon={onResetProjectIcon
														? () => onResetProjectIcon(group.projectPath)
														: undefined}
													onRemoveProject={onRemoveProject
														? () => onRemoveProject(group.projectPath)
														: undefined}
												/>
												{#if shouldShowProjectUtilityActions() && onOpenTerminal}
													<Tooltip.Root>
														<Tooltip.Trigger>
															<button
																type="button"
																class={projectHeaderHoverActionButtonClass}
																onclick={(event) => {
																	event.stopPropagation();
																	onOpenTerminal(group.projectPath);
																}}
																aria-label={m.sidebar_open_terminal({ projectName: group.projectName })}
															>
																<Terminal class="h-3 w-3" weight="fill" />
															</button>
														</Tooltip.Trigger>
														<Tooltip.Content>
															{m.sidebar_open_terminal({ projectName: group.projectName })}
														</Tooltip.Content>
													</Tooltip.Root>
												{/if}
												{#if shouldShowProjectUtilityActions() && onOpenBrowser}
													<Tooltip.Root>
														<Tooltip.Trigger>
															<button
																type="button"
																class={projectHeaderHoverActionButtonClass}
																onclick={(event) => {
																	event.stopPropagation();
																	onOpenBrowser(group.projectPath);
																}}
																aria-label={m.sidebar_open_browser({ projectName: group.projectName })}
															>
																<Browser class="h-3 w-3" weight="fill" />
															</button>
														</Tooltip.Trigger>
														<Tooltip.Content>
															{m.sidebar_open_browser({ projectName: group.projectName })}
														</Tooltip.Content>
													</Tooltip.Root>
												{/if}
												{#if shouldShowProjectCreateButton()}
													<div
														class="flex items-center"
														role="presentation"
														onclick={(e) => handleProjectCreateButtonClick(e, group.projectPath)}
														onkeydown={(e) => e.stopPropagation()}
													>
														<Tooltip.Root>
															<Tooltip.Trigger>
																<button
																	type="button"
																	class="flex items-center justify-center size-5 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
																	aria-label={getProjectCreateButtonTooltipLabel(group.projectName)}
																>
																	<IconPlus class="h-3 w-3" />
																</button>
															</Tooltip.Trigger>
															<Tooltip.Content>
																{getProjectCreateButtonTooltipLabel(group.projectName)}
															</Tooltip.Content>
														</Tooltip.Root>
													</div>
												{/if}
											</div>
										{/snippet}
									</ProjectHeader>
								</ContextMenu.Trigger>
									<ContextMenu.Content class="min-w-[180px] p-1 text-[11px]">
										<ContextMenu.Item
											disabled={onReorderProjects === undefined || projectIndex === 0}
											onSelect={() => {
												void handleProjectContextMove(group.projectPath, -1);
											}}
										>
											<ArrowUp class="mr-2 h-3.5 w-3.5" weight="bold" />
											{m.project_move_up()}
										</ContextMenu.Item>
										<ContextMenu.Item
											disabled={
												onReorderProjects === undefined || projectIndex === sessionGroups.length - 1
											}
											onSelect={() => {
												void handleProjectContextMove(group.projectPath, 1);
											}}
										>
											<ArrowDown class="mr-2 h-3.5 w-3.5" weight="bold" />
											{m.project_move_down()}
										</ContextMenu.Item>
										{#if onChangeProjectIcon || (onResetProjectIcon && group.projectIconSrc)}
											<ContextMenu.Separator />
										{/if}
										{#if onChangeProjectIcon}
											<ContextMenu.Item onclick={() => onChangeProjectIcon(group.projectPath)}>
												<ImageSquare class="mr-2 h-3.5 w-3.5" weight="fill" />
												{m.project_icon_change()}
											</ContextMenu.Item>
										{/if}
										{#if onResetProjectIcon && group.projectIconSrc}
											<ContextMenu.Item onclick={() => onResetProjectIcon(group.projectPath)}>
												<ArrowCounterClockwise class="mr-2 h-3.5 w-3.5" weight="bold" />
												{m.project_icon_reset()}
											</ContextMenu.Item>
										{/if}
									</ContextMenu.Content>
							</ContextMenu.Root>
						</div>
						<!-- Session list skeleton (sessions are what we're loading) -->
						<div class="flex-1 min-h-0 max-h-[22rem] overflow-y-auto overflow-x-hidden px-0.5 pb-0.5">
							<SessionListSkeleton sessionCount={3} />
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<!-- No projects yet: full skeleton fallback -->
			<div class="flex flex-col flex-1 min-h-0 gap-0.5">
				{#each Array.from({ length: 2 }, (_, i) => i) as index (index)}
					<ProjectCardSkeleton sessionCount={3} isExpanded={true} />
				{/each}
			</div>
		{/if}
	{:else}
		<!-- Session groups - expanded sections share available space equally -->
		{@const expandedCount = expandedProjects.size}
		{@const maxHeightPercent = expandedCount > 0 ? 100 / expandedCount : 100}
		<div class="relative flex flex-col flex-1 min-h-0 gap-0.5">
			{#each sessionGroups as group, projectIndex (group.projectPath)}
				{@const isExpanded = expandedProjects.has(group.projectPath)}
				{@const viewMode = getProjectViewMode(group.projectPath)}
				{@const filesLoading = loadingFilesProjects.has(group.projectPath)}
				{@const filesError = filesErrorByProject.get(group.projectPath)}
				{@const flattenedFiles = getFlattenedFiles(group.projectPath)}
				<div
					class="flex flex-col overflow-hidden rounded-md bg-card/75"
					style={isExpanded
						? `flex: 0 1 auto; max-height: ${maxHeightPercent}%; min-height: 0;`
						: "flex: 0 0 auto;"}
				>
				<!-- Project header -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					use:projectHeaderFocusTarget={group.projectPath}
					class="shrink-0 flex items-center"
					role="button"
					tabindex={0}
					onclick={() => handleProjectHeaderClick(group.projectPath)}
					onkeydown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							handleProjectHeaderClick(group.projectPath);
						}
					}}
				>
					<ContextMenu.Root>
						<ContextMenu.Trigger class="flex-1 min-w-0">
							<ProjectHeader
								projectColor={group.projectColor}
								projectName={group.projectName}
								projectIconSrc={group.projectIconSrc}
								expanded={isExpanded}
								class="group min-w-0 flex-1 cursor-pointer transition-colors"
							>
								{#snippet actions()}
									<div
										class="flex shrink-0 items-center gap-0.5"
										role="presentation"
										onclick={(e) => e.stopPropagation()}
										onkeydown={(e) => e.stopPropagation()}
									>
										<ProjectHeaderOverflowMenu
											projectName={group.projectName}
											currentColor={group.projectColor}
											currentViewMode={viewMode}
											onColorChange={onProjectColorChange
												? (color) => onProjectColorChange(group.projectPath, color)
												: undefined}
											onViewModeChange={(mode) => setProjectViewMode(group.projectPath, mode)}
											projectIconSrc={group.projectIconSrc}
											onResetProjectIcon={onResetProjectIcon
												? () => onResetProjectIcon(group.projectPath)
												: undefined}
											onRemoveProject={onRemoveProject
												? () => onRemoveProject(group.projectPath)
												: undefined}
										/>
										{#if shouldShowProjectUtilityActions() && onOpenTerminal}
											<Tooltip.Root>
												<Tooltip.Trigger>
													<button
														type="button"
														class={projectHeaderHoverActionButtonClass}
														onclick={(event) => {
															event.stopPropagation();
															onOpenTerminal(group.projectPath);
														}}
														aria-label={m.sidebar_open_terminal({ projectName: group.projectName })}
													>
														<Terminal class="h-3 w-3" weight="fill" />
													</button>
												</Tooltip.Trigger>
												<Tooltip.Content>
													{m.sidebar_open_terminal({ projectName: group.projectName })}
												</Tooltip.Content>
											</Tooltip.Root>
										{/if}
										{#if shouldShowProjectUtilityActions() && onOpenBrowser}
											<Tooltip.Root>
												<Tooltip.Trigger>
													<button
														type="button"
														class={projectHeaderHoverActionButtonClass}
														onclick={(event) => {
															event.stopPropagation();
															onOpenBrowser(group.projectPath);
														}}
														aria-label={m.sidebar_open_browser({ projectName: group.projectName })}
													>
														<Browser class="h-3 w-3" weight="fill" />
													</button>
												</Tooltip.Trigger>
												<Tooltip.Content>
													{m.sidebar_open_browser({ projectName: group.projectName })}
												</Tooltip.Content>
											</Tooltip.Root>
										{/if}
										{#if shouldShowProjectCreateButton()}
											<div
												class="flex shrink-0 items-center"
												role="presentation"
												onclick={(e) => handleProjectCreateButtonClick(e, group.projectPath)}
												onkeydown={(e) => e.stopPropagation()}
											>
												<Tooltip.Root>
													<Tooltip.Trigger>
														<button
															type="button"
															class="flex items-center justify-center size-5 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
															aria-label={getProjectCreateButtonTooltipLabel(group.projectName)}
														>
															<IconPlus class="h-3 w-3" />
														</button>
													</Tooltip.Trigger>
													<Tooltip.Content>
														{getProjectCreateButtonTooltipLabel(group.projectName)}
													</Tooltip.Content>
												</Tooltip.Root>
											</div>
										{/if}
									</div>
								{/snippet}
							</ProjectHeader>
						</ContextMenu.Trigger>
							<ContextMenu.Content class="min-w-[180px] p-1 text-[11px]">
								<ContextMenu.Item
									disabled={onReorderProjects === undefined || projectIndex === 0}
									onSelect={() => {
										void handleProjectContextMove(group.projectPath, -1);
									}}
								>
									<ArrowUp class="mr-2 h-3.5 w-3.5" weight="bold" />
									{m.project_move_up()}
								</ContextMenu.Item>
								<ContextMenu.Item
									disabled={onReorderProjects === undefined || projectIndex === sessionGroups.length - 1}
									onSelect={() => {
										void handleProjectContextMove(group.projectPath, 1);
									}}
								>
									<ArrowDown class="mr-2 h-3.5 w-3.5" weight="bold" />
									{m.project_move_down()}
								</ContextMenu.Item>
								{#if onChangeProjectIcon || (onResetProjectIcon && group.projectIconSrc)}
									<ContextMenu.Separator />
								{/if}
								{#if onChangeProjectIcon}
									<ContextMenu.Item onclick={() => onChangeProjectIcon(group.projectPath)}>
										<ImageSquare class="mr-2 h-3.5 w-3.5" weight="fill" />
										{m.project_icon_change()}
									</ContextMenu.Item>
								{/if}
								{#if onResetProjectIcon && group.projectIconSrc}
									<ContextMenu.Item onclick={() => onResetProjectIcon(group.projectPath)}>
										<ArrowCounterClockwise class="mr-2 h-3.5 w-3.5" weight="bold" />
										{m.project_icon_reset()}
									</ContextMenu.Item>
								{/if}
							</ContextMenu.Content>
					</ContextMenu.Root>
				</div>

					<!-- Content area: Sessions OR Files (switched, not both) -->
					{#if isExpanded}
						{#if viewMode === "sessions"}
							<!-- Sessions view - use simple overflow for scrolling -->
							{@const sidebarSessions = getSidebarSessions(group.sessions)}
							{@const visibleSessions = getVisibleSessionsForProject(group)}
							<div
								class="min-h-0 max-h-[22rem] overflow-y-auto overflow-x-hidden px-0.5 pb-0.5"
								use:sessionListContainer={{ projectPath: group.projectPath, totalSessions: sidebarSessions.length }}
								onscroll={() => handleSessionListScroll(group.projectPath, sidebarSessions.length)}
							>
								{#if scanningProjectPaths.has(group.projectPath) && group.sessions.length === 0}
									<SessionListSkeleton sessionCount={3} />
								{:else}
									<VirtualizedSessionList
										sessions={visibleSessions}
										{selectedSessionId}
										onSelectSession={handleSessionSelect}
										{onOpenPr}
										onArchive={onArchiveSession}
										{onRenameSession}
										{onExportMarkdown}
										{onExportJson}
									/>
								{/if}
							</div>
						{:else}
							<!-- Files view -->
							<ScrollArea class="min-h-0 px-0.5 pb-0.5">
								{#if filesLoading}
									<!-- Loading skeleton for files -->
									<div class="flex flex-col gap-0.5 p-0.5">
										{#each Array.from({ length: 5 }, (_, i) => i) as index (index)}
											<div class="px-2 py-1.5 flex items-center gap-2">
												<Skeleton class="h-3.5 w-3.5 shrink-0 rounded" />
												<Skeleton class="h-3 w-2/3" />
											</div>
										{/each}
									</div>
								{:else if filesError}
									<!-- Error state -->
									<div class="px-2.5 py-2 text-xs text-destructive">
										{filesError}
									</div>
								{:else if flattenedFiles.length === 0}
									<!-- Empty files -->
									<div class="px-2.5 py-2 text-xs text-muted-foreground">
										{m.file_list_empty()}
									</div>
								{:else}
									<!-- File tree -->
									<div class="flex flex-col gap-0.5 p-0.5">
										{#each flattenedFiles as { node, projectPath: projPath } (`${projPath}:${node.path}`)}
											<FileTreeItem
												{node}
												projectPath={projPath}
												isExpanded={expandedFolders.has(`${projPath}:${node.path}`)}
												onToggleFolder={toggleFolder}
												onSelectFile={handleFileSelect}
												onCopyPath={() => {}}
												onRevealInFinder={handleRevealInFinder}
												onRefresh={() => handleRefreshFileTree(projPath)}
												onDeleteConfirm={handleDeleteConfirm}
												onRename={handleRenameConfirm}
												onDuplicate={handleDuplicateRequest}
												onNewFile={handleNewFileRequest}
												onNewFolder={handleNewFolderRequest}
											/>
										{/each}
									</div>
								{/if}
							</ScrollArea>
						{/if}
					{/if}

					<!-- Git footer with branch picker -->
					{#if isExpanded}
					{#if gitDataByProject.has(group.projectPath)}
						{@const gitData = gitDataByProject.get(group.projectPath)!}
						{@const isFetching = fetchingProjects.has(group.projectPath)}
						{@const totalIns = gitData.gitStatus?.reduce((s, f) => s + f.insertions, 0) ?? 0}
						{@const totalDel = gitData.gitStatus?.reduce((s, f) => s + f.deletions, 0) ?? 0}
						{@const ahead = gitData.remoteStatus?.ahead ?? 0}
						{@const behind = gitData.remoteStatus?.behind ?? 0}
						<div class="shrink-0 flex items-center border-t border-border/30">
							<!-- Branch picker segment (branch name + diff only) -->
							<DropdownMenu.Root
								open={openBranchPickerProject === group.projectPath}
								onOpenChange={(isOpen) => {
									openBranchPickerProject = isOpen ? group.projectPath : null;
								}}
							>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											class="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-background/70"
										>
											<GitBranch
												class="h-3 w-3 shrink-0"
												weight="fill"
												style="color: {Colors.purple}"
											/>
											<span class="font-mono truncate leading-none text-[11px]">
												{gitData.branch ?? "branch"}
											</span>
											{#if totalIns > 0 || totalDel > 0}
												<DiffPill
													insertions={totalIns}
													deletions={totalDel}
													variant="plain"
													class="text-[11px]"
												/>
											{/if}
											<ChevronDown
												class="h-2.5 w-2.5 shrink-0 text-muted-foreground ml-auto transition-transform duration-200 {openBranchPickerProject ===
												group.projectPath
													? 'rotate-180'
													: ''}"
											/>
										</button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Portal>
								<DropdownMenu.Content
									align="start"
									sideOffset={4}
									class="z-[var(--app-blocking-z)] isolate w-[260px] overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=open]:animate-in"
								>
										<div class="space-y-2">
											<!-- Search input -->
											<div class="relative">
												<MagnifyingGlass
													class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none"
												/>
												<Input
													bind:ref={branchInputRef}
													bind:value={branchQuery}
													placeholder="Search branches"
													class="h-8 rounded-md border-border/80 pl-8 text-xs"
												/>
											</div>

											<!-- Branch list -->
											<div class="px-1 text-[11px] text-muted-foreground font-medium">Branches</div>
											<div class="max-h-[180px] overflow-y-auto space-y-0.5 pr-0.5">
												{#if loadingBranches}
													<div class="px-2 py-1.5 text-[11px] text-muted-foreground">
														Loading branches...
													</div>
												{:else if branchLoadFailed}
													<div class="px-2 py-1.5 text-[11px] text-muted-foreground">
														Could not load branches
													</div>
												{:else if filteredBranches.length === 0}
													<div class="px-2 py-1.5 text-[11px] text-muted-foreground">
														No branches found
													</div>
												{:else}
													{#each filteredBranches as branch (branch)}
														<button
															type="button"
															class="w-full flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent"
															onclick={() => handleSwitchBranch(group.projectPath, branch, false)}
															disabled={switchingBranch}
														>
															<span class="flex items-center gap-2 min-w-0">
																<GitBranch
																	class="h-3 w-3 shrink-0"
																	style="color: {Colors.purple}"
																/>
																<span class="font-mono truncate">{branch}</span>
															</span>
															{#if branch === gitData.branch}
																<Check class="h-3.5 w-3.5 text-foreground shrink-0" />
															{/if}
														</button>
													{/each}
												{/if}
											</div>

											<!-- Actions -->
											<div class="h-px bg-border/80"></div>
											<div class="space-y-0.5">
												<button
													type="button"
													class="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-accent text-muted-foreground"
													onclick={() => openCreateBranchDialog(group.projectPath)}
												>
													<GitBranch class="h-3 w-3 shrink-0" style="color: {Colors.purple}" />
													<span>Create and checkout new branch...</span>
												</button>
											</div>
										</div>
									</DropdownMenu.Content>
								</DropdownMenu.Portal>
							</DropdownMenu.Root>

							<!-- Up/down widget: ahead & behind counts + Update (pull) when behind -->
							<div class="flex items-center shrink-0 text-[11px] font-mono leading-none text-muted-foreground">
								{#if ahead > 0 || behind > 0}
									<span class="inline-flex h-7 items-center gap-1.5 px-1.5">
										{#if ahead > 0}
											<span
												class="inline-flex items-center gap-0.5"
												title="{ahead} commit{ahead > 1 ? 's' : ''} ahead"
											>
												<IconArrowUp class="h-2.5 w-2.5 text-success" />
												{ahead}
											</span>
										{/if}
										{#if behind > 0}
											<span class="inline-flex items-center gap-1">
												<span
													class="inline-flex items-center gap-0.5"
													title="{behind} commit{behind > 1 ? 's' : ''} behind"
												>
													<IconArrowDown class="h-2.5 w-2.5" style="color: {Colors.orange}" />
													{behind}
												</span>
												<Tooltip.Root>
													<Tooltip.Trigger>
														<button
															type="button"
															class="inline-flex h-5 min-w-5 items-center justify-center rounded bg-background/70 px-1 text-[10px] font-medium text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
															disabled={pullingProjects.has(group.projectPath)}
															onclick={(e) => handlePullRemote(e, group.projectPath)}
														>
															{pullingProjects.has(group.projectPath) ? "…" : "Update"}
														</button>
													</Tooltip.Trigger>
													<Tooltip.Content>
														<span>Pull to update branch</span>
													</Tooltip.Content>
												</Tooltip.Root>
											</span>
										{/if}
									</span>
								{/if}
							</div>

							<!-- Action buttons: Fetch + Source Control -->
							<div class="flex items-center gap-0.5">
								<Tooltip.Root>
									<Tooltip.Trigger>
										<button
											class="flex items-center justify-center size-5 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
											disabled={isFetching}
											onclick={(e) => handleFetchRemote(e, group.projectPath)}
										>
											<ArrowsClockwise
												class="h-3 w-3 {isFetching ? 'animate-spin' : ''}"
												weight="bold"
											/>
										</button>
									</Tooltip.Trigger>
									<Tooltip.Content>
										<span>{isFetching ? "Fetching…" : "Fetch remote"}</span>
									</Tooltip.Content>
								</Tooltip.Root>
									{#if onOpenGitPanel}
										<Tooltip.Root>
											<Tooltip.Trigger>
												<button
													class="flex items-center justify-center size-5 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
													onclick={(e) => handleOpenGitPanel(e, group.projectPath)}
												>
													<GitBranch class="h-3 w-3" weight="fill" />
											</button>
										</Tooltip.Trigger>
										<Tooltip.Content>Source Control</Tooltip.Content>
									</Tooltip.Root>
								{/if}
							</div>
						</div>
					{:else if nonGitProjects.has(group.projectPath)}
						<!-- Non-git repo: show initialize button in branch picker style -->
						<div class="shrink-0 flex items-center border-t border-border/30">
							<button
								class="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
								disabled={initializingGitProject === group.projectPath}
								onclick={(e) => handleInitGitRepo(e, group.projectPath)}
							>
								<GitBranch class="h-3 w-3 shrink-0" />
								<span class="text-[11px]">
									{initializingGitProject === group.projectPath
										? "Initializing..."
										: "Initialize Git Repository"}
								</span>
							</button>
						</div>
					{/if}
					{/if}
				</div>
			{/each}

			<!-- Trailing project card skeletons while scanning -->
			{#if scanning && sessionGroups.length > 0}
				<div class="shrink-0 flex flex-col gap-0.5 opacity-50">
					{#each Array.from({ length: 2 }, (_, i) => i) as index (index)}
						<ProjectCardSkeleton sessionCount={2} isExpanded={true} />
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<span class="sr-only" role="status" aria-live="polite">{reorderAnnouncement}</span>
</div>

<!-- New file dialog -->
<Dialog.Root bind:open={newFileDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.file_list_new_file()}</Dialog.Title>
		</Dialog.Header>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleNewFileSubmit();
			}}
			class="space-y-4"
		>
			<div class="grid gap-2">
				<Label for="new-file-input">{m.file_list_new_file_prompt()}</Label>
				<Input id="new-file-input" bind:value={newFileInput} class="w-full" />
			</div>
			<Dialog.Footer>
				<Dialog.Close type="button" class={buttonVariants({ variant: "outline" })}>
					{m.common_cancel()}
				</Dialog.Close>
				<Button type="submit">{m.common_confirm()}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- New folder dialog -->
<Dialog.Root bind:open={newFolderDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.file_list_new_folder()}</Dialog.Title>
		</Dialog.Header>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleNewFolderSubmit();
			}}
			class="space-y-4"
		>
			<div class="grid gap-2">
				<Label for="new-folder-input">{m.file_list_new_folder_prompt()}</Label>
				<Input id="new-folder-input" bind:value={newFolderInput} class="w-full" />
			</div>
			<Dialog.Footer>
				<Dialog.Close type="button" class={buttonVariants({ variant: "outline" })}>
					{m.common_cancel()}
				</Dialog.Close>
				<Button type="submit">{m.common_confirm()}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Create branch dialog -->
<Dialog.Root bind:open={createBranchDialogOpen}>
	<Dialog.Content class="max-w-md rounded-2xl">
		<Dialog.Header>
			<Dialog.Title>Create and checkout branch</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-3 py-2">
			<label for="sidebar-new-branch-name" class="text-sm font-medium">Branch name</label>
			<!-- Button group: prefix selector + input -->
			<div class="flex items-stretch">
				<!-- Prefix dropdown trigger -->
				<DropdownMenu.Root bind:open={prefixDropdownOpen}>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								type="button"
								class="flex items-center gap-1.5 rounded-l-md border border-r-0 border-border bg-muted/50 px-2.5 text-xs hover:bg-accent transition-colors shrink-0"
							>
								<selectedPrefix.icon
									class="h-3.5 w-3.5 shrink-0"
									weight="fill"
									style="color: {selectedPrefix.color}"
								/>
								<span class="font-mono">{selectedPrefix.value || "—"}</span>
								<ChevronDown
									class="h-3 w-3 text-muted-foreground transition-transform duration-200 {prefixDropdownOpen
										? 'rotate-180'
										: ''}"
								/>
							</button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						align="start"
						sideOffset={4}
						class="min-w-[10rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=open]:animate-in"
					>
						{#each BRANCH_PREFIXES as prefix (prefix.label)}
							<button
								type="button"
								class="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
								onclick={() => {
									selectedPrefix = prefix;
									prefixDropdownOpen = false;
									queueMicrotask(() => newBranchInputRef?.focus());
								}}
							>
								<prefix.icon
									class="h-3.5 w-3.5 shrink-0"
									weight="fill"
									style="color: {prefix.color}"
								/>
								<span>{prefix.label}</span>
								{#if selectedPrefix === prefix}
									<Check class="h-3.5 w-3.5 ml-auto text-foreground shrink-0" />
								{/if}
							</button>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<!-- Branch name input -->
				<Input
					id="sidebar-new-branch-name"
					bind:ref={newBranchInputRef}
					bind:value={newBranchName}
					placeholder="my-feature"
					class="rounded-l-none font-mono"
					onkeydown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							handleCreateBranchSubmit();
						}
					}}
				/>
			</div>
			{#if newBranchNameError}
				<p class="text-[12px] text-destructive">{newBranchNameError}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" class="rounded-lg" onclick={() => (createBranchDialogOpen = false)}>
				Close
			</Button>
			<Button class="rounded-lg" disabled={!canCreateBranch} onclick={handleCreateBranchSubmit}>
				Create and checkout
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
