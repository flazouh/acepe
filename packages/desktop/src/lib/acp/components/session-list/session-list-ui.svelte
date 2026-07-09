<script lang="ts">
import {
	AppSidebarProjectGroup,
	ProjectHeader,
	ProjectHeaderOverflowMenu,
} from "@acepe/ui/app-layout";
import { PLUS_ACTION_BUTTON_CLASS, PlusIcon } from "@acepe/ui";
import { tick } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import { Button } from "$lib/components/ui/button/index.js";
import {
	ProjectCardSkeleton,
	SessionListSkeleton,
} from "$lib/components/ui/skeleton/index.js";
import type { AgentInfo } from "../../logic/agent-manager.js";
import {
	getSidebarSessions,
	getNextSessionListVisibleCount,
	getSessionListVisibleCount,
	isSessionListNearBottom,
	resolveDefaultAgentIdForCreate,
} from "./session-list-logic.js";
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
	/** Called when user copies session transcript as Markdown */
	onCopyTranscriptMarkdown?: (sessionId: string) => void | Promise<void>;
	/** Called when user copies session transcript as JSON */
	onCopyTranscriptJson?: (sessionId: string) => void | Promise<void>;
	/** Called when user opens the raw transcript in Acepe */
	onOpenTranscriptInAcepe?: (session: SessionDisplayItem) => void | Promise<void>;
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
	onCopyTranscriptMarkdown,
	onCopyTranscriptJson,
	onOpenTranscriptInAcepe,
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
			sessionListContainers.delete(projectPath);
		}
	}
});

// Rename dialog

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

function getFilteredSidebarSessionsForProject(group: SessionGroup): SessionListItem[] {
	return getSidebarSessions(group.sessions);
}

function getVisibleSessionsForProject(group: SessionGroup): SessionListItem[] {
	const sidebarSessions = getFilteredSidebarSessionsForProject(group);
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
 * Accessible label for the project `+` button. When a saved default agent
 * resolves, advertise that the left-click will spawn that agent directly; otherwise
 * keep the generic "New session in {projectName}" wording.
 */
function getProjectCreateButtonAriaLabel(projectName: string): string {
	const resolvedDefaultId = resolveDefaultAgentIdForCreateLocal();
	if (resolvedDefaultId !== undefined) {
		const agent = availableAgents.find((a) => a.id === resolvedDefaultId);
		if (agent) {
			return `New ${agent.name} session in ${projectName}`;
		}
	}
	return `New session in ${projectName}`;
}

const projectHeaderHoverActionButtonClass = PLUS_ACTION_BUTTON_CLASS;

function getShowExternalCliSessions(projectPath: string): boolean {
	return projectShowExternalCliSessions.get(projectPath) ?? true;
}

function isAcepeOnlyFilterActive(projectPath: string): boolean {
	return !getShowExternalCliSessions(projectPath);
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
			<button
				type="button"
				class={projectHeaderHoverActionButtonClass}
				onclick={(event) => handleProjectCreateButtonClick(event, group.projectPath)}
				aria-label={getProjectCreateButtonAriaLabel(group.projectName)}
			>
				<PlusIcon />
			</button>
		{/if}
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
			projectBadgeLabel={group.projectBadgeLabel}
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
								class="flex-1 min-h-0 max-h-[22rem] overflow-y-auto overflow-x-hidden pb-0.5 [scrollbar-gutter:stable]"
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
								class="min-h-0 max-h-[22rem] overflow-y-auto overflow-x-hidden pb-0.5 [scrollbar-gutter:stable]"
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
										{onCopyTranscriptMarkdown}
										{onCopyTranscriptJson}
										{onOpenTranscriptInAcepe}
									/>
								{/if}
							</div>
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
