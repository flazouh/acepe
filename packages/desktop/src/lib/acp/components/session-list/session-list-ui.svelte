<script lang="ts">
import {
	AppSidebarProjectGroup,
	ProjectHeader,
	ProjectHeaderOverflowMenu,
} from "@acepe/ui/app-layout";
import { Colors } from "@acepe/ui/colors";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import { IconArrowDown } from "@tabler/icons-svelte";
import { IconArrowUp } from "@tabler/icons-svelte";
import { IconPlus } from "@tabler/icons-svelte";
import { listen } from "@tauri-apps/api/event";
import { ArrowsClockwise } from "phosphor-svelte";
import { GitBranch } from "phosphor-svelte";
import { FolderOpen } from "phosphor-svelte";
import { tick } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import {
	ProjectCardSkeleton,
	SessionListSkeleton,
	Skeleton,
} from "$lib/components/ui/skeleton/index.js";
import * as Tooltip from "@acepe/ui/tooltip";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { AgentInfo } from "../../logic/agent-manager.js";
import ProjectFileSystemDialog from "../file-explorer-modal/project-file-system-dialog.svelte";
import BranchPicker from "../branch-picker/branch-picker.svelte";
import {
	getSidebarSessions,
	getNextSessionListVisibleCount,
	getSessionListVisibleCount,
	isSessionListNearBottom,
	resolveDefaultAgentIdForCreate,
} from "./session-list-logic.js";
import {
	fetchRemote,
	type GitOverviewData,
	type GitOverviewState,
	loadGitOverview as loadGitOverviewImpl,
	pullRemote,
} from "./session-list-git-overview.js";
import {
	getMovedProjectOrder,
	getProjectGroupByPath,
	isProjectOrderUnchanged,
} from "./session-list-project-order.js";
import type { SessionGroup, SessionListItem } from "./session-list-types.js";
import VirtualizedSessionList from "./virtualized-session-list.svelte";

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
	/** Called when collapsed project paths change (for persistence) */
	onCollapsedProjectPathsChange?: (paths: string[]) => void;
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
	/** Per-project visibility for discovered external CLI sessions */
	projectShowExternalCliSessions?: ReadonlyMap<string, boolean>;
	/** Toggle whether discovered external CLI sessions appear in this project's list */
	onToggleShowExternalCliSessions?: (projectPath: string, showExternalCliSessions: boolean) => void;
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
	onCollapsedProjectPathsChange,
	onOpenGitPanel,
	onOpenPr,
	onArchiveSession,
	onRenameSession,
	onExportMarkdown,
	onExportJson,
	onReorderProjects,
	projectShowExternalCliSessions = new Map(),
	onToggleShowExternalCliSessions,
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

const visibleSessionCounts = new SvelteMap<string, number>();
const projectHistoryQueries = new SvelteMap<string, string>();
const sessionListContainers = new Map<string, HTMLDivElement>();

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
			projectHistoryQueries.delete(projectPath);
			sessionListContainers.delete(projectPath);
		}
	}
});

// Rename dialog

let fileExplorerDialogProject = $state<{
	projectPath: string;
	projectName: string;
	projectColor: string | undefined;
	projectIconSrc: string | null;
} | null>(null);

function toggleProject(projectPath: string) {
	if (collapsedProjects.has(projectPath)) {
		collapsedProjects.delete(projectPath);
	} else {
		collapsedProjects.add(projectPath);
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

function getProjectHistoryQuery(projectPath: string): string {
	return projectHistoryQueries.get(projectPath) ?? "";
}

function setProjectHistoryQuery(projectPath: string, query: string): void {
	if (query.length === 0) {
		projectHistoryQueries.delete(projectPath);
		return;
	}
	projectHistoryQueries.set(projectPath, query);
}

function getFilteredSidebarSessionsForProject(group: SessionGroup): SessionListItem[] {
	const sidebarSessions = getSidebarSessions(group.sessions);
	const query = getProjectHistoryQuery(group.projectPath).trim().toLowerCase();
	if (query.length === 0) {
		return sidebarSessions;
	}
	return sidebarSessions.filter((session) => {
		const haystack = `${session.title} ${session.agentId}`.toLowerCase();
		return haystack.includes(query);
	});
}

function getVisibleSessionsForProject(group: SessionGroup): SessionListItem[] {
	const sidebarSessions = getFilteredSidebarSessionsForProject(group);
	const visibleCount = getSessionListVisibleCount(
		sidebarSessions.length,
		visibleSessionCounts.get(group.projectPath)
	);
	return sidebarSessions.slice(0, visibleCount);
}

function handleProjectHistorySearchKeydown(event: KeyboardEvent): void {
	event.stopPropagation();
}

function ensureSessionListOverflow(projectPath: string, totalSessions: number): void {
	const container = sessionListContainers.get(projectPath);
	if (!container) {
		return;
	}

	if (
		!isSessionListNearBottom(container.scrollTop, container.clientHeight, container.scrollHeight)
	) {
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
): {
	update: (nextParams: { projectPath: string; totalSessions: number }) => void;
	destroy: () => void;
} {
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

// ─── Git overview state (per-project) ──────────────────────────────
const gitDataByProject = new SvelteMap<string, GitOverviewData>();
const gitLoadedProjects = new SvelteSet<string>();
const nonGitProjects = new SvelteSet<string>();
const fetchingProjects = new SvelteSet<string>();
const pullingProjects = new SvelteSet<string>();
const gitOverviewRequestVersionByProject = new Map<string, number>();
let initializingGitProject = $state<string | null>(null);
const gitOverviewState: GitOverviewState = {
	gitDataByProject,
	gitLoadedProjects,
	nonGitProjects,
	fetchingProjects,
	pullingProjects,
	gitOverviewRequestVersionByProject,
};

function loadGitOverview(projectPath: string) {
	loadGitOverviewImpl(gitOverviewState, projectPath);
}

function handleInitGitRepo(projectPath: string): void {
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
	fetchRemote(gitOverviewState, projectPath);
}

function handlePullRemote(event: MouseEvent, projectPath: string) {
	event.stopPropagation();
	pullRemote(gitOverviewState, projectPath);
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
			return `New ${agent.name} session in ${projectName}`;
		}
	}
	return `New session in ${projectName}`;
}

function handleOpenGitPanel(event: MouseEvent, projectPath: string) {
	event.stopPropagation();
	onOpenGitPanel?.(projectPath);
}

const projectHeaderHoverActionButtonClass =
	"flex items-center justify-center size-5 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

function getShowExternalCliSessions(projectPath: string): boolean {
	return projectShowExternalCliSessions.get(projectPath) ?? true;
}

function isAcepeOnlyFilterActive(projectPath: string): boolean {
	return !getShowExternalCliSessions(projectPath);
}

function handleOpenFileExplorer(event: MouseEvent, group: SessionGroup): void {
	event.stopPropagation();
	fileExplorerDialogProject = {
		projectPath: group.projectPath,
		projectName: group.projectName,
		projectColor: group.projectColor,
		projectIconSrc: group.projectIconSrc,
	};
}

function handleCloseFileExplorer(): void {
	fileExplorerDialogProject = null;
}

function handleProjectHeaderClick(projectPath: string) {
	toggleProject(projectPath);
}

function announceProjectReorder(projectPath: string, orderedPaths: string[]): void {
	const group = getProjectGroupByPath(sessionGroups, projectPath);
	const position = orderedPaths.indexOf(projectPath);

	if (group === null || position < 0) {
		return;
	}

	reorderAnnouncement = "";
	queueMicrotask(() => {
		reorderAnnouncement = `Moved ${group.projectName} to position ${position + 1} of ${orderedPaths.length}`;
	});
}

function applyProjectOrder(projectPath: string, orderedPaths: string[]): void {
	if (onReorderProjects === undefined || isProjectOrderUnchanged(sessionGroups, orderedPaths)) {
		return;
	}

	announceProjectReorder(projectPath, orderedPaths);
	onReorderProjects(orderedPaths);
}

async function focusProjectContextTrigger(projectPath: string): Promise<void> {
	await tick();
	// Return focus to the outer header wrapper so consecutive keyboard move
	// actions stay anchored on the same project row.
	projectHeaderFocusTargets.get(projectPath)?.focus();
}

async function handleProjectContextMove(projectPath: string, offset: -1 | 1): Promise<void> {
	const orderedPaths = getMovedProjectOrder(sessionGroups, projectPath, offset);

	if (orderedPaths === null) {
		return;
	}

	applyProjectOrder(projectPath, orderedPaths);
	await focusProjectContextTrigger(projectPath);
}

function handleBranchSelected(projectPath: string): void {
	gitLoadedProjects.delete(projectPath);
	loadGitOverview(projectPath);
}
</script>

{#snippet projectOverflowMenu(group, projectIndex)}
	<ProjectHeaderOverflowMenu
		projectName={group.projectName}
		currentColor={group.projectColor}
		onColorChange={onProjectColorChange
			? (color) => onProjectColorChange(group.projectPath, color)
			: undefined}
		projectIconSrc={group.projectIconSrc}
		onResetProjectIcon={onResetProjectIcon
			? () => onResetProjectIcon(group.projectPath)
			: undefined}
		onRemoveProject={onRemoveProject ? () => onRemoveProject(group.projectPath) : undefined}
		onMoveUp={() => {
			void handleProjectContextMove(group.projectPath, -1);
		}}
		onMoveDown={() => {
			void handleProjectContextMove(group.projectPath, 1);
		}}
		moveUpDisabled={onReorderProjects === undefined || projectIndex === 0}
		moveDownDisabled={onReorderProjects === undefined ||
			projectIndex === sessionGroups.length - 1}
		onChangeProjectIcon={onChangeProjectIcon
			? () => onChangeProjectIcon(group.projectPath)
			: undefined}
		hideExternalCliSessions={isAcepeOnlyFilterActive(group.projectPath)}
		onHideExternalCliSessionsChange={onToggleShowExternalCliSessions
			? (hide) => onToggleShowExternalCliSessions(group.projectPath, !hide)
			: undefined}
	/>
{/snippet}

{#snippet projectHeaderActions(group, projectIndex)}
	<div
		class="flex shrink-0 items-center gap-0.5"
		role="presentation"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		{#if shouldShowProjectCreateButton()}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class={projectHeaderHoverActionButtonClass}
						onclick={(event) => handleProjectCreateButtonClick(event, group.projectPath)}
						aria-label={getProjectCreateButtonTooltipLabel(group.projectName)}
					>
						<IconPlus class="h-3 w-3" />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					{getProjectCreateButtonTooltipLabel(group.projectName)}
				</Tooltip.Content>
			</Tooltip.Root>
		{/if}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					type="button"
					class={projectHeaderHoverActionButtonClass}
					onclick={(event) => handleOpenFileExplorer(event, group)}
					aria-label={`Open file system in ${group.projectName}`}
				>
					<FolderOpen class="h-3 w-3" weight="fill" />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>
				{`Open file system in ${group.projectName}`}
			</Tooltip.Content>
		</Tooltip.Root>
		{@render projectOverflowMenu(group, projectIndex)}
	</div>
{/snippet}

{#snippet sidebarProjectHeader(group, projectIndex, isExpanded)}
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
		<ProjectHeader
			projectColor={group.projectColor}
			projectName={group.projectName}
			projectIconSrc={group.projectIconSrc}
			expanded={isExpanded}
			class="group min-w-0 flex-1 cursor-pointer transition-colors"
		>
			{#snippet actions()}
				{@render projectHeaderActions(group, projectIndex)}
			{/snippet}
		</ProjectHeader>
	</div>
{/snippet}

<div
	class="relative flex h-full min-h-0 flex-col gap-2 overflow-y-auto outline-none"
	data-thread-list-scrollable
>
	{#if loading && !scanning && sessionGroups.every((g) => g.sessions.length === 0)}
		<!-- Initial loading (no sessions cached yet): real project headers + session list skeleton -->
		{#if sessionGroups.length > 0}
			<div class="flex flex-col flex-1 min-h-0 gap-0.5">
				{#each sessionGroups as group, projectIndex (group.projectPath)}
					<AppSidebarProjectGroup class="min-w-0">
						{#snippet header()}
							{@render sidebarProjectHeader(group, projectIndex, true)}
						{/snippet}
						{#snippet children()}
							<div
								class="flex-1 min-h-0 max-h-[22rem] overflow-y-auto overflow-x-hidden pb-0.5"
							>
								<SessionListSkeleton sessionCount={3} />
							</div>
						{/snippet}
					</AppSidebarProjectGroup>
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
				<AppSidebarProjectGroup
					style={isExpanded
						? `flex: 0 1 auto; max-height: ${maxHeightPercent}%; min-height: 0;`
						: "flex: 0 0 auto;"}
				>
					{#snippet header()}
						{@render sidebarProjectHeader(group, projectIndex, isExpanded)}
					{/snippet}
					{#snippet children()}
						{#if isExpanded}
							{@const filteredSessions = getFilteredSidebarSessionsForProject(group)}
							{@const visibleSessions = getVisibleSessionsForProject(group)}
							<div
								class="shrink-0 px-1 pt-1 pb-1"
								role="presentation"
								onclick={(event) => event.stopPropagation()}
								onkeydown={handleProjectHistorySearchKeydown}
							>
								<Input
									type="search"
									value={getProjectHistoryQuery(group.projectPath)}
									placeholder="Search project history..."
									class="h-5 rounded-md border-border/70 bg-background/70 px-1 py-0 text-[10px] md:text-[10px]"
									data-sidebar-project-history-search
									oninput={(event) =>
										setProjectHistoryQuery(group.projectPath, event.currentTarget.value)}
								/>
							</div>
							<div
								class="min-h-0 max-h-[22rem] overflow-y-auto overflow-x-hidden pb-0.5"
								use:sessionListContainer={{ projectPath: group.projectPath, totalSessions: filteredSessions.length }}
								onscroll={() => handleSessionListScroll(group.projectPath, filteredSessions.length)}
							>
								{#if scanningProjectPaths.has(group.projectPath) && group.sessions.length === 0}
									<SessionListSkeleton sessionCount={3} />
								{:else if filteredSessions.length === 0}
									<div class="px-2 py-6 text-center text-[11px] text-muted-foreground">
										No sessions found
									</div>
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
						{/if}
					{/snippet}
					{#snippet footer()}
						{#if isExpanded}
					{#if gitDataByProject.has(group.projectPath)}
						{@const gitData = gitDataByProject.get(group.projectPath)!}
						{@const isFetching = fetchingProjects.has(group.projectPath)}
						{@const totalIns = gitData.gitStatus?.reduce((s, f) => s + f.insertions, 0) ?? 0}
						{@const totalDel = gitData.gitStatus?.reduce((s, f) => s + f.deletions, 0) ?? 0}
						{@const ahead = gitData.remoteStatus?.ahead ?? 0}
						{@const behind = gitData.remoteStatus?.behind ?? 0}
						<div class="shrink-0 flex items-center border-t border-border/30">
							<BranchPicker
								projectPath={group.projectPath}
								currentBranch={gitData.branch}
								diffStats={totalIns > 0 || totalDel > 0
									? { insertions: totalIns, deletions: totalDel }
									: null}
								isGitRepo={true}
								class="min-w-0 flex-1"
								onBranchSelected={() => handleBranchSelected(group.projectPath)}
							/>

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
											class="flex items-center justify-center size-5 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
													class="flex items-center justify-center size-5 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
						<div class="shrink-0 flex items-center border-t border-border/30">
							<BranchPicker
								projectPath={group.projectPath}
								currentBranch={null}
								diffStats={null}
								isGitRepo={false}
								class="min-w-0 flex-1"
								initGitLoading={initializingGitProject === group.projectPath}
								onInitGitRepo={() => handleInitGitRepo(group.projectPath)}
							/>
						</div>
						{/if}
						{/if}
					{/snippet}
				</AppSidebarProjectGroup>
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

{#if fileExplorerDialogProject !== null}
	<ProjectFileSystemDialog
		open={true}
		projectPath={fileExplorerDialogProject.projectPath}
		projectName={fileExplorerDialogProject.projectName}
		projectColor={fileExplorerDialogProject.projectColor}
		projectIconSrc={fileExplorerDialogProject.projectIconSrc}
		onClose={handleCloseFileExplorer}
		onOpenFile={(projectPath, filePath) => {
			onSelectFile?.(filePath, projectPath);
			handleCloseFileExplorer();
		}}
	/>
{/if}
