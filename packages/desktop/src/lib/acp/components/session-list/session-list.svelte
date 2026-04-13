<script lang="ts">
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";

import { KEYBINDING_ACTIONS } from "$lib/keybindings/constants.js";
import { getKeybindingsService } from "$lib/keybindings/index.js";
import type { AgentInfo } from "../../logic/agent-manager.js";
import type { Project } from "../../logic/project-manager.svelte.js";
import { checkpointStore } from "../../store/checkpoint-store.svelte.js";
import type { SessionWithEntries } from "./session-list-logic.js";
import * as logic from "./session-list-logic.js";
import { SessionListState } from "./session-list-state.svelte.js";
import type { SessionListItem } from "./session-list-types.js";
import SessionListUI from "./session-list-ui.svelte";

interface Props {
	sessions: readonly SessionWithEntries[];
	loading?: boolean;
	scanningProjectPaths?: ReadonlySet<string>;
	recentProjects?: readonly Project[];
	selectedSessionId?: string | null;
	canCreateSession?: boolean;
	isSessionOpen?: (sessionId: string) => boolean;
	scanning?: boolean;
	/** Initial file tree expansion state for persistence */
	initialFileTreeExpansion?: Record<string, string[]>;
	/** Initial project file view modes for persistence */
	initialProjectFileViewModes?: Record<string, "sessions" | "files">;
	/** Initial collapsed project paths for persistence */
	initialCollapsedProjectPaths?: string[];
	onSelectSession: (sessionId: string, sessionInfo?: SessionListItem) => void;
	onCreateSession?: () => void;
	onCreateSessionForProject?: (projectPath: string, agentId?: string) => void;
	/** Available agents for session creation */
	availableAgents?: AgentInfo[];
	/** Current theme for agent icons */
	effectiveTheme?: "light" | "dark";
	onProjectClick?: (projectPath: string) => void;
	onProjectColorChange?: (projectPath: string, color: string) => void;
	onRemoveProject?: (projectPath: string) => void;
	onSelectFile?: (filePath: string, projectPath: string) => void;
	/** Called when file tree expansion state changes */
	onFileTreeExpansionChange?: (expansion: Record<string, string[]>) => void;
	/** Called when project file view mode changes (sessions vs files) */
	onProjectFileViewModeChange?: (modes: Record<string, "sessions" | "files">) => void;
	/** Called when collapsed project paths change */
	onCollapsedProjectPathsChange?: (paths: string[]) => void;
	/** Called when terminal button is clicked for a project */
	onOpenTerminal?: (projectPath: string) => void;
	/** Called when browser button is clicked for a project */
	onOpenBrowser?: (projectPath: string) => void;
	/** Called when git panel button is clicked for a project */
	onOpenGitPanel?: (projectPath: string) => void;
	/** Called when PR badge is clicked on a session row */
	onOpenPr?: (sessionInfo: SessionListItem) => void;
	/** Called when user archives a session from the sidebar */
	onArchiveSession?: (session: SessionDisplayItem) => void | Promise<void>;
	/** Called when user renames a session from the sidebar */
	onRenameSession?: (session: SessionListItem, title: string) => void | Promise<void>;
	/** Called when user exports session as markdown */
	onExportMarkdown?: (sessionId: string) => void | Promise<void>;
	/** Called when user exports session as JSON */
	onExportJson?: (sessionId: string) => void | Promise<void>;
}

let {
	sessions,
	loading = false,
	scanningProjectPaths = new Set(),
	recentProjects = [],
	selectedSessionId = null,
	canCreateSession = false,
	isSessionOpen = () => false,
	scanning = false,
	initialFileTreeExpansion = {},
	initialProjectFileViewModes = {},
	initialCollapsedProjectPaths = [],
	onSelectSession,
	onCreateSession,
	onCreateSessionForProject,
	availableAgents = [],
	effectiveTheme = "light",
	onProjectClick,
	onProjectColorChange,
	onRemoveProject,
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
}: Props = $props();

// ✅ State manager for local UI state only
const state = new SessionListState();

// ✅ Keyboard shortcut
const kb = getKeybindingsService();
const shortcutKeys = $derived.by(() => {
	return kb.getShortcutArray(KEYBINDING_ACTIONS.THREAD_CREATE) || ["⌘", "N"];
});

// ✅ Derived - compute open session IDs
const openSessionIds = $derived.by(() => {
	return new Set(
		sessions.filter((session) => isSessionOpen(session.id)).map((session) => session.id)
	);
});

// ✅ Derived - all computations using pure logic functions
const projectColorMap = $derived(logic.createProjectColorMap(recentProjects));
const projectNameMap = $derived(logic.createProjectNameMap(recentProjects));
const projectCreatedAtMap = $derived(new Map(recentProjects.map((p) => [p.path, p.createdAt])));

// Filter sessions to only include those belonging to known projects
const projectPaths = $derived(new Set(recentProjects.map((p) => p.path)));
const projectSessions = $derived(sessions.filter((s) => projectPaths.has(s.projectPath)));

const displayItems = $derived(
	logic.createDisplayItems(
		projectSessions,
		projectNameMap,
		projectColorMap,
		openSessionIds,
		(sessionId) => checkpointStore.getCheckpoints(sessionId)
	)
);

const filteredItems = $derived(logic.filterItems(displayItems, state.searchQuery));
const sessionGroupsFromData = $derived(
	logic.createSessionGroups(filteredItems, projectCreatedAtMap, recentProjects)
);
const loadingSessionGroups = $derived(logic.createLoadingSessionGroups(recentProjects));
// Only show skeletons on initial load (no sessions yet).
// Re-scans should NOT flash skeletons over existing session data.
const hasAnySessions = $derived(sessionGroupsFromData.some((g) => g.sessions.length > 0));
const sessionGroups = $derived(
	loading && !hasAnySessions ? loadingSessionGroups : sessionGroupsFromData
);

const hasResults = $derived(filteredItems.length > 0);
const totalCount = $derived(projectSessions.length);
const hasProjects = $derived(recentProjects.length > 0);

// ✅ Event handlers - can access current props directly
function handleSelectSession(item: SessionListItem) {
	onSelectSession(item.id, item);
}

function handleCreateSession() {
	onCreateSession?.();
}

function handleCreateSessionForProject(projectPath: string, agentId?: string) {
	onCreateSessionForProject?.(projectPath, agentId);
}
</script>

<SessionListUI
	{canCreateSession}
	{shortcutKeys}
	{onProjectColorChange}
	{onRemoveProject}
	{sessionGroups}
	{hasResults}
	{loading}
	{scanningProjectPaths}
	{totalCount}
	{hasProjects}
	{selectedSessionId}
	{scanning}
	{initialFileTreeExpansion}
	{initialProjectFileViewModes}
	{initialCollapsedProjectPaths}
	onSelectSession={handleSelectSession}
	onCreateSession={handleCreateSession}
	onCreateSessionForProject={handleCreateSessionForProject}
	{availableAgents}
	{effectiveTheme}
	{onProjectClick}
	{onSelectFile}
	{onFileTreeExpansionChange}
	{onProjectFileViewModeChange}
	{onCollapsedProjectPathsChange}
	{onOpenTerminal}
	{onOpenBrowser}
	{onOpenGitPanel}
	{onOpenPr}
	{onArchiveSession}
	onRenameSession={onRenameSession}
	{onExportMarkdown}
	{onExportJson}
/>
