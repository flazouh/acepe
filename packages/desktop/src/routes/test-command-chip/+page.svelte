<script lang="ts">
import {
	AgentInputAttachMenu,
	AgentInputSlashCommandDropdown,
	type AttachMenuCommandSection,
	AgentToolSearch,
	AgentToolSkill,
	AgentInputMicButton,
	AgentInputModeIcon,
	AgentInputAgentSelector,
	DefaultAgentHeartIcon,
	AgentPanelPreSessionWorktreeCard,
	AgentPanelSignInCard,
	AgentPanelPermissionBarIcon,
	AgentCompactToolDisplay,
	AgentPanelModifiedFileRow,
	AgentPanelModifiedFilesTrailingControls,
	AgentToolThinking,
	AgentToolQuestion,
	TodoNumberIcon,
	ToolKindIcon,
	CommandChip,
	ReviewWorkspaceHeader,
	type SlashPaletteSection,
	type CommandChipModel,
	type AgentPanelModifiedFileItem,
	type AgentPanelModifiedFilesTrailingModel,
} from "@acepe/ui/agent-panel";
import {
	KanbanSceneBoard,
	LayoutModeIcon,
	PrChecksList,
	SectionedFeed,
	type KanbanSceneCardData,
	type KanbanSceneColumnGroup,
	type PrChecksItem,
	type SectionedFeedGroup,
	type SectionedFeedItemData,
} from "@acepe/ui";
import { FeedSectionHeader } from "@acepe/ui/attention-queue";
import { Button } from "@acepe/ui/button";
import { AppTabBarTab, type AppTab } from "@acepe/ui/app-layout";
import { NativeMarkdown } from "@acepe/ui/native-markdown";
import { FilePanelHeader } from "@acepe/ui/file-panel";
import {
	SqlStudioSidebar,
	type SqlConnection,
	type SqlSchemaInfo,
} from "@acepe/ui/sql-studio";
import {
	GitPanelLayout,
	GitLogList,
	GitStashList,
	GitWorkspace,
	GitStatusFileRow,
	type GitLogEntry,
	type GitRemoteStatus,
	type GitStatusFile,
	type GitStashEntry,
} from "@acepe/ui/git-panel";
import {
	BuildIcon,
	DatabaseIcon,
	DiscordIcon,
	PaletteIcon,
	PlanIcon,
	RecycleIcon,
	RoundedIcon,
	RobotIcon,
	StorageIcon,
	WrenchIcon,
} from "@acepe/ui/icons";
import AddRepositoryActionsCell from "$lib/acp/components/add-repository/cells/actions-cell.svelte";
import PaletteItem from "$lib/acp/components/advanced-command-palette/palette-item.svelte";
import { BRANCH_PREFIXES } from "$lib/acp/components/branch-picker/branch-prefix-options.js";
import CreateBranchDialog from "$lib/acp/components/branch-picker/create-branch-dialog.svelte";
import ProjectCard from "$lib/acp/components/project-card.svelte";
import type { ProjectCardData } from "$lib/acp/components/project-card-data.js";
import type { PaletteItem as CommandPaletteItem } from "$lib/acp/types/palette-item.js";
import type { SessionSummary } from "$lib/acp/application/dto/session-summary.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import { BrandThemeToggle, setTheme, type Theme } from "$lib/components/theme/index.js";
import AgentEnvOverridesDialog from "$lib/components/settings-page/sections/agent-env-overrides-dialog.svelte";
import SettingsSidebar from "$lib/components/settings-page/settings-sidebar.svelte";
import type { SettingsSectionId } from "$lib/components/settings-page/settings-types.js";
import SessionTable from "$lib/components/settings/project-tab/session-table.svelte";

const modelCommandChip: CommandChipModel = {
	command: "/model",
	message: "model",
	stdout: "",
	displayModelName: "Opus 4.8",
	displayModelDescription: "High reasoning",
	isModelCommand: true,
};

const projectCardData: ProjectCardData = {
	project: {
		path: "/Users/alex/Documents/acepe",
		name: "Acepe",
		lastOpened: new Date("2026-07-01T00:00:00.000Z"),
		createdAt: new Date("2026-07-01T00:00:00.000Z"),
		color: "#6B7CFF",
	},
	branch: "main",
	gitStatus: [],
	ahead: 1,
	behind: 2,
};

const gitRemoteStatus: GitRemoteStatus = {
	ahead: 1,
	behind: 2,
	remote: "origin",
	trackingBranch: "origin/main",
};

const modifiedGitFiles: GitStatusFile[] = [
	{
		path: "packages/ui/src/components/git-panel/git-status-file-row.svelte",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 3,
		deletions: 1,
	},
	{
		path: "packages/ui/src/components/icons/file-status-icon.svelte",
		indexStatus: null,
		worktreeStatus: "untracked",
		additions: 24,
		deletions: 0,
	},
	{
		path: "packages/ui/src/components/git-viewer/old-file-tree.svelte",
		indexStatus: null,
		worktreeStatus: "deleted",
		additions: 0,
		deletions: 18,
	},
];

const stagedGitFiles: GitStatusFile[] = [
	{
		path: "packages/ui/src/components/git-viewer/git-file-tree.svelte",
		indexStatus: "renamed",
		worktreeStatus: null,
		additions: 6,
		deletions: 4,
	},
];

const agentSelectorAgents = [
	{ id: "claude", name: "claude", providerBrand: null, providerLabel: "Claude" },
	{ id: "codex", name: "codex", providerBrand: null, providerLabel: "Codex" },
] as const;

const gitLogFixtureEntries: GitLogEntry[] = [
	{
		sha: "b3f2c9d8a1e4",
		shortSha: "b3f2c9d",
		message: "Use rounded commit icon",
		author: "alex",
		date: "2026-07-01",
	},
];

const sessionTableProjects: Project[] = [
	{
		path: "/Users/alex/Documents/acepe",
		name: "Acepe",
		lastOpened: new Date("2026-07-01T00:00:00.000Z"),
		createdAt: new Date("2026-07-01T00:00:00.000Z"),
		color: "#6B7CFF",
	},
];

const sessionTableSessions: SessionSummary[] = Array.from(
	{ length: 24 },
	(_, index): SessionSummary => {
		const ordinal = index + 1;
		return {
				id: `fixture-session-${ordinal}`,
				projectPath: "/Users/alex/Documents/acepe",
				agentId: "codex",
				title: `Pagination fixture ${ordinal}`,
			status: "ready",
			entryCount: ordinal,
			isConnected: true,
			isStreaming: false,
			createdAt: new Date("2026-07-01T00:00:00.000Z"),
			updatedAt: new Date(Date.UTC(2026, 6, 1, 0, ordinal, 0)),
			parentId: null,
		};
	}
);

const skillCommandItem = {
	id: "fixture-skill-diagnose",
	label: "diagnose",
	description: "Diagnose hard bugs.",
	tokenType: "skill",
	insertText: "/diagnose",
} as const;

const attachMenuCommandSections: AttachMenuCommandSection[] = [
	{
		id: "skills",
		label: "Skills",
		items: [skillCommandItem],
	},
];

const slashPaletteSections: SlashPaletteSection[] = [
	{
		id: "skills",
		label: "Skills",
		items: [
			{
				id: skillCommandItem.id,
				kind: "skill",
				label: skillCommandItem.label,
				description: skillCommandItem.description,
				tokenType: skillCommandItem.tokenType,
				commandName: skillCommandItem.label,
				insertText: skillCommandItem.insertText,
			},
		],
	},
];

const slashPalettePosition = {
	top: 310,
	left: 620,
};

const activeSettingsSection: SettingsSectionId = "general";

const permissionIconKinds = [
	"read",
	"edit",
	"execute",
	"search",
	"fetch",
	"delete",
	"move",
	"browser",
	"unknown",
] as const;

const filePanelDisplayModes = [
	{ id: "rendered", label: "Rendered" },
	{ id: "structured", label: "Tree" },
	{ id: "table", label: "Table" },
	{ id: "raw", label: "Raw" },
];

let createBranchDialogOpen = $state(false);
let fixtureTheme = $state<Theme>("system");
const themeState = setTheme({
	theme: () => fixtureTheme,
	setTheme: (nextTheme) => {
		fixtureTheme = nextTheme;
	},
});

const modifiedFilesTrailingModel: AgentPanelModifiedFilesTrailingModel = {
	reviewLabel: "Review",
	reviewedCount: 1,
	totalCount: 3,
	onReview: () => {},
};

const partialReviewFile: AgentPanelModifiedFileItem = {
	id: "partial-review-file",
	filePath: "packages/ui/src/components/agent-panel/review-tab-strip.svelte",
	fileName: "review-tab-strip.svelte",
	reviewStatus: "unreviewed",
	additions: 8,
	deletions: 2,
	onSelect: () => {},
};

const neutralPrChecks: PrChecksItem[] = [
	{
		name: "Skipped preview deploy",
		status: "COMPLETED",
		conclusion: "NEUTRAL",
		detailsUrl: null,
		startedAt: "2026-07-01T00:00:00.000Z",
		completedAt: "2026-07-01T00:00:01.000Z",
		workflowName: "Preview",
	},
];

const stashFixtureEntries: GitStashEntry[] = [
	{
		index: 0,
		message: "WIP rounded icons",
		date: "2026-07-01",
	},
];

const sqlStudioConnections: SqlConnection[] = [
	{
		id: "fixture-sqlite",
		name: "Local app database",
		engine: "sqlite",
		subtitle: "acepe.sqlite",
	},
];

const sqlStudioSchema: SqlSchemaInfo[] = [
	{
		name: "public",
		tables: [
			{
				name: "users",
				schema: "public",
				columns: [
					{
						name: "id",
						dataType: "uuid",
						nullable: false,
						isPrimaryKey: true,
					},
					{
						name: "email",
						dataType: "text",
						nullable: false,
						isPrimaryKey: false,
					},
				],
			},
		],
	},
];

const multiSelectQuestionFixture = [
	{
		header: "Question",
		question: "Pick the follow-up tasks",
		multiSelect: true,
		options: [
			{ label: "Keep docs", description: "Already selected." },
			{ label: "Run QA", description: "Still available." },
		],
	},
];

const multiSelectQuestionSelectedLabels = {
	0: ["Keep docs"],
};

const questionTabFixture: AppTab = {
	id: "question-tab-fixture",
	title: "Needs input",
	projectName: "Acepe",
	projectColor: "#6B7CFF",
	sequenceId: 8,
	status: "question",
	isFocused: true,
	tooltipText: "Waiting for user input",
};

const codeFeedGroups: SectionedFeedGroup<SectionedFeedItemData>[] = [
	{
		id: "needs_review",
		label: "Needs review",
		items: [{}],
	},
];

const codeKanbanCard: KanbanSceneCardData = {
	id: "plan-approval-code-fixture",
	title: "Review plan",
	richTitle: null,
	agentIconSrc: null,
	agentLabel: "Codex",
	isAutoMode: false,
	projectName: "Acepe",
	projectColor: "#6B7CFF",
	projectIconSrc: null,
	activityText: null,
	isStreaming: false,
	modeId: null,
	diffInsertions: 0,
	diffDeletions: 0,
	errorText: null,
	todoProgress: null,
	taskCard: null,
	latestTool: null,
	hasUnseenCompletion: false,
	sequenceId: null,
	prFooter: null,
	hideHeaderDiff: false,
	footer: {
		kind: "plan_approval",
		prompt: "review changes",
		approveLabel: "Approve",
		rejectLabel: "Cancel",
	},
	menuActions: [],
	showCloseAction: false,
	hideBody: true,
	flushFooter: true,
};

const codeKanbanGroups: KanbanSceneColumnGroup[] = [
	{
		id: "needs_review",
		label: "Needs review",
		items: [codeKanbanCard],
	},
];

const commandPaletteItems: CommandPaletteItem[] = [
	{
		id: "thread.create",
		label: "Create new thread",
		description: "Start a new conversation",
		roundedIcon: "new-chat",
		metadata: {
			keybinding: "Cmd+T",
		},
	},
	{
		id: "settings.open",
		label: "Open settings",
		description: "Configure application preferences",
		roundedIcon: "settings",
		metadata: {
			keybinding: "Cmd+,",
		},
	},
	{
		id: "sidebar.toggle",
		label: "Toggle sidebar",
		description: "Show or hide the sidebar",
		roundedIcon: "sidebar",
		metadata: {
			keybinding: "Cmd+B",
		},
	},
	{
		id: "thread.close",
		label: "Close current thread",
		description: "Close the active conversation",
		roundedIcon: "close",
		metadata: {
			keybinding: "Cmd+W",
		},
	},
	{
		id: "sync.refresh",
		label: "Refresh sync",
		description: "Resynchronize data",
		roundedIcon: "refresh",
		metadata: {},
	},
	{
		id: "debug.toggle",
		label: "Toggle debug panel",
		description: "Show developer debug information",
		roundedIcon: "terminal",
		metadata: {},
	},
	{
		id: "session.chat",
		label: "Session result",
		description: "Fallback conversation icon",
		roundedIcon: "chat",
		metadata: {},
	},
];
</script>

<div class="h-screen w-screen space-y-4 overflow-auto bg-background p-4">
	<div class="max-w-[600px]" data-testid="command-chip-fixture">
		<CommandChip model={modelCommandChip} />
	</div>
	<div class="w-[320px]" data-testid="project-card-fixture">
		<ProjectCard data={projectCardData} index={0} onSelect={() => {}} />
	</div>
	<div
		class="flex w-[160px] items-center justify-end gap-2 border border-border/40 p-2"
		data-testid="add-repository-actions-fixture"
	>
		<AddRepositoryActionsCell isAdded={false} onImport={() => {}} onUndo={() => {}} />
		<AddRepositoryActionsCell isAdded={true} onImport={() => {}} onUndo={() => {}} />
	</div>
	<div
		class="flex w-[160px] items-center gap-2 border border-border/40 p-2"
		data-testid="button-icon-muted-fixture"
	>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Chrome icon fixture"
			data-testid="button-icon-muted"
		>
			<RoundedIcon name="more" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Compact icon fixture"
			data-testid="button-icon-muted"
		>
			<RoundedIcon name="close" />
		</Button>
	</div>
	<div class="flex w-[220px] items-center gap-2 border border-border/40 bg-foreground/80 p-2" data-testid="brand-theme-toggle-fixture">
		<Button variant="ghost" size="xs" data-testid="brand-theme-force-light" onclick={() => themeState.setTheme("light")}>
			Light
		</Button>
		<Button variant="ghost" size="xs" data-testid="brand-theme-force-dark" onclick={() => themeState.setTheme("dark")}>
			Dark
		</Button>
		<Button variant="ghost" size="xs" data-testid="brand-theme-force-system" onclick={() => themeState.setTheme("system")}>
			System
		</Button>
		<BrandThemeToggle />
	</div>
	<div class="flex w-[220px] items-center gap-2 border border-border/40 p-2" data-testid="app-tab-question-fixture">
		<AppTabBarTab tab={questionTabFixture} />
	</div>
	<div class="flex items-center gap-3 border border-border/40 p-2" data-testid="layout-mode-icon-fixture">
		<LayoutModeIcon
			mode="grid"
			color="#9B8CFF"
			class="size-3"
			data-testid="fixture-layout-grid-icon"
		/>
		<LayoutModeIcon
			mode="columns"
			color="#F6A04D"
			class="size-3"
			data-testid="fixture-layout-columns-icon"
		/>
		<LayoutModeIcon
			mode="kanban"
			color="#FF6F9F"
			class="size-3"
			data-testid="fixture-layout-kanban-icon"
		/>
	</div>
	<div
		class="flex w-[160px] items-center gap-3 border border-border/40 p-2"
		data-testid="plan-icon-fixture"
	>
		<PlanIcon size="sm" data-testid="plan-icon-sm" />
		<PlanIcon size="md" data-testid="plan-icon-md" />
		<PlanIcon size="lg" data-testid="plan-icon-lg" />
	</div>
	<div
		class="flex w-[160px] items-center gap-3 border border-border/40 p-2"
		data-testid="build-icon-fixture"
	>
		<BuildIcon size="sm" data-testid="build-icon-sm-css" />
		<BuildIcon size="md" data-testid="build-icon-md-css" />
		<BuildIcon size="lg" data-testid="build-icon-lg-css" />
	</div>
	<div
		class="flex w-[120px] items-center gap-3 border border-border/40 p-2 text-muted-foreground"
		data-testid="wrench-icon-fixture"
	>
		<WrenchIcon size={12} data-testid="wrench-icon-sm" />
		<WrenchIcon class="size-4 text-foreground" data-testid="wrench-icon-md" />
	</div>
	<div
		class="flex w-[120px] items-center gap-3 border border-border/40 p-2 text-muted-foreground"
		data-testid="database-storage-icon-fixture"
	>
		<DatabaseIcon size={14} data-testid="database-icon-sm" />
		<StorageIcon size={14} data-testid="storage-icon-sm" />
	</div>
	<div
		class="flex w-[150px] items-center gap-3 border border-border/40 p-2 text-muted-foreground"
		data-testid="semantic-local-icon-fixture"
	>
		<PaletteIcon size={14} data-testid="palette-icon-sm" />
		<RobotIcon size={14} data-testid="robot-icon-sm" />
		<RecycleIcon size={14} data-testid="recycle-icon-sm" />
		<DiscordIcon size={14} data-testid="discord-icon-sm" />
	</div>
	<div class="w-[520px] space-y-2" data-testid="agent-tool-skill-fixture">
		<AgentToolSkill skillName="diagnose" description="Diagnose hard bugs." status="done" />
		<AgentCompactToolDisplay
			tool={{
				id: "compact-skill",
				kind: "skill",
				title: "/diagnose",
				subtitle: "Investigating failure",
				status: "done",
			}}
		/>
	</div>
	<div class="w-[520px] space-y-2" data-testid="slash-command-skill-fixture">
		<AgentInputAttachMenu
			showModes={false}
			showContextActions={false}
			commandSections={attachMenuCommandSections}
			onCommandItemSelect={() => {}}
		/>
		<AgentInputSlashCommandDropdown
			sections={slashPaletteSections}
			isOpen={true}
			query=""
			position={slashPalettePosition}
			onItemSelect={() => {}}
			onClose={() => {}}
		/>
	</div>
	<div class="w-[220px] border border-border/40 p-2" data-testid="attach-menu-context-actions-fixture">
		<AgentInputAttachMenu
			showModes={false}
			showContextActions={true}
			commandSections={[]}
			onAddFileContext={() => {}}
			onAttachImage={() => {}}
		/>
	</div>
	<div class="h-[360px] w-[760px] border border-border/40 p-2" data-testid="session-table-fixture">
		<SessionTable sessions={sessionTableSessions} projects={sessionTableProjects} loading={false} />
	</div>
	<div class="w-[680px] border border-border/40 p-2" data-testid="file-panel-display-mode-icons-fixture">
		<FilePanelHeader
			fileName="package.json"
			filePath="/Users/alex/Documents/acepe/package.json"
			projectName="Acepe"
			projectColor="#6B7CFF"
			hasContent={true}
			displayModes={filePanelDisplayModes}
			activeDisplayMode="rendered"
			onDisplayModeChange={() => {}}
			onClose={() => {}}
		/>
	</div>
	<div class="w-[420px] border border-border/40 p-2" data-testid="native-markdown-unlink-fixture">
		<NativeMarkdown
			markdown="[Acepe PR](https://github.com/flazouh/acepe/pull/42)"
			linkedPrNumber={42}
			onTogglePrLink={() => {}}
		/>
	</div>
	<div class="h-[320px] w-[760px] border border-border/40" data-testid="git-workspace-fixture">
		<GitWorkspace
			branch="main"
			remoteStatus={gitRemoteStatus}
			activeSection="changes"
			onSectionChange={() => {}}
			activeView="status"
			onViewChange={() => {}}
			stagedFiles={stagedGitFiles}
			unstagedFiles={modifiedGitFiles}
			selectedFile=""
			onFileSelect={() => {}}
			onStage={() => {}}
			onUnstage={() => {}}
			onStageAll={() => {}}
			onDiscard={() => {}}
			logEntries={[]}
			stashEntries={[]}
			commitMessage=""
			onCommitMessageChange={() => {}}
			onCommit={() => {}}
			canCommit={false}
			canCommitPush={false}
			canCommitPushPr={false}
			onCommitPush={() => {}}
			onCommitPushPr={() => {}}
			generating={false}
		/>
	</div>
		<div class="h-[320px] w-[760px] border border-border/40" data-testid="git-panel-layout-fixture">
			<GitPanelLayout
				branch="main"
				remoteStatus={gitRemoteStatus}
				stagedFiles={stagedGitFiles}
				unstagedFiles={modifiedGitFiles}
				activeView="status"
				onViewChange={() => {}}
				onFileSelect={() => {}}
				selectedFile=""
			/>
		</div>
		<div class="w-[460px] border border-border/40 p-2" data-testid="git-status-file-row-status-icons-fixture">
			<GitStatusFileRow
				path="packages/ui/src/components/icons/file-status-icon.svelte"
				status="untracked"
				additions={24}
				deletions={0}
				section="unstaged"
			/>
			<GitStatusFileRow
				path="packages/ui/src/components/git-viewer/old-file-tree.svelte"
				status="deleted"
				additions={0}
				deletions={18}
				section="unstaged"
			/>
			<GitStatusFileRow
				path="packages/ui/src/components/git-viewer/git-file-tree.svelte"
				status="renamed"
				additions={6}
				deletions={4}
				section="staged"
			/>
		</div>
		<div class="h-[120px] w-[420px] border border-border/40 p-2" data-testid="git-log-rounded-icon-fixture">
			<GitLogList entries={gitLogFixtureEntries} />
		</div>
		<div class="w-[340px] border border-border/40 p-2" data-testid="git-stash-archive-fixture">
			<GitStashList entries={stashFixtureEntries} />
		</div>
	<div class="w-[240px] border border-border/40 p-2" data-testid="settings-sidebar-fixture">
		<SettingsSidebar
			activeSection={activeSettingsSection}
				onSectionChange={() => {}}
			/>
		</div>
		<div class="w-[360px] border border-border/40 p-2" data-testid="env-overrides-dialog-fixture">
			<AgentEnvOverridesDialog
				agentId="codex"
				agentName="Codex"
				value={{ TEST_TOKEN: "secret" }}
				onSave={() => {}}
			/>
		</div>
		<div class="w-[360px] border border-border/40 p-2" data-testid="pre-session-worktree-fixture">
			<AgentPanelPreSessionWorktreeCard
			pendingWorktreeEnabled={true}
			onYes={() => {}}
			onNo={() => {}}
			onDismiss={() => {}}
		/>
	</div>
	<div class="w-[360px] border border-border/40 p-2" data-testid="pre-session-local-fixture">
		<AgentPanelPreSessionWorktreeCard
			pendingWorktreeEnabled={false}
			onYes={() => {}}
			onNo={() => {}}
			onDismiss={() => {}}
		/>
	</div>
	<div class="w-[360px] border border-border/40 p-2" data-testid="agent-sign-in-card-fixture">
		<AgentPanelSignInCard
			title="Sign in required"
			message="Claude needs an authenticated session before it can continue."
			onSignIn={() => {}}
			onDismiss={() => {}}
		/>
	</div>
	<div
		class="flex w-[240px] items-center gap-3 border border-border/40 p-2"
		data-testid="permission-bar-icon-fixture"
	>
		{#each permissionIconKinds as kind (kind)}
			<span class="inline-flex size-6 items-center justify-center rounded-md bg-input/40">
				<AgentPanelPermissionBarIcon {kind} size={14} color="var(--muted-foreground)" />
			</span>
		{/each}
	</div>
	<div class="w-[260px] border border-border/40 p-2" data-testid="agent-selector-heart-fixture">
		<AgentInputAgentSelector
			availableAgents={agentSelectorAgents}
			currentAgentId="claude"
			defaultAgentId="claude"
			onAgentChange={() => {}}
			onDefaultAgentToggle={() => {}}
			showLabel={true}
		>
			{#snippet renderAgentIcon({ class: iconClass })}
				<RoundedIcon name="chat" class={iconClass} />
			{/snippet}
		</AgentInputAgentSelector>
	</div>
	<div
		class="flex w-[120px] items-center gap-3 border border-border/40 p-2 text-muted-foreground"
		data-testid="default-agent-heart-icon-fixture"
	>
		<span class="text-red-500">
			<DefaultAgentHeartIcon filled={true} />
		</span>
		<span>
			<DefaultAgentHeartIcon />
		</span>
	</div>
	<div class="w-[420px] border border-border/40 p-2" data-testid="command-palette-icon-fixture">
		{#each commandPaletteItems as item, index (item.id)}
			<PaletteItem
				{item}
				isSelected={index === 0}
				isLast={index === commandPaletteItems.length - 1}
				onclick={() => {}}
				onmouseenter={() => {}}
			/>
		{/each}
	</div>
	<div class="flex items-center gap-2 border border-border/40 p-2" data-testid="branch-prefix-dialog-fixture">
		<Button
			variant="ghost"
			size="xs"
			data-testid="branch-prefix-dialog-open"
			onclick={() => {
				createBranchDialogOpen = true;
			}}
		>
			Open branch dialog
		</Button>
		<CreateBranchDialog
			bind:open={createBranchDialogOpen}
			branches={["main"]}
			switchingBranch={false}
			inputId="branch-prefix-fixture-input"
			onCreate={() => {}}
			onOpenChange={(open) => {
				createBranchDialogOpen = open;
			}}
		/>
	</div>
	<div class="flex flex-wrap gap-2 border border-border/40 p-2" data-testid="branch-prefix-options-fixture">
		{#each BRANCH_PREFIXES as prefix (prefix.label)}
			<span
				class="inline-flex items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1 text-[11px]"
				data-testid={`branch-prefix-option-${prefix.label}`}
			>
				{#if prefix.roundedIcon}
					<RoundedIcon
						name={prefix.roundedIcon}
						class="size-3.5 shrink-0"
						style="color: {prefix.color}"
						data-testid={`branch-prefix-option-${prefix.label}-rounded-icon`}
					/>
				{:else if prefix.icon}
					<prefix.icon class="size-3.5 shrink-0" weight="fill" style="color: {prefix.color}" />
				{/if}
				<span>{prefix.label}</span>
			</span>
		{/each}
	</div>
	<div class="flex items-center gap-2 border border-border/40 p-2" data-testid="modified-files-trailing-controls-fixture">
		<AgentPanelModifiedFilesTrailingControls
			model={modifiedFilesTrailingModel}
			isExpanded={false}
			onToggle={() => {}}
		/>
	</div>
	<div class="flex items-center gap-2 border border-border/40 p-2" data-testid="tool-kind-review-code-fixture">
		<ToolKindIcon kind="review" size={12} />
	</div>
	<div class="flex items-center gap-3 border border-border/40 p-2" data-testid="rounded-tool-kind-icons-fixture">
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-read-rounded">
			<ToolKindIcon kind="read" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-edit-rounded">
			<ToolKindIcon kind="edit" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-delete-rounded">
			<ToolKindIcon kind="delete" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-execute-rounded">
			<ToolKindIcon kind="execute" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-search-rounded">
			<ToolKindIcon kind="search" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-read-lints-rounded">
			<ToolKindIcon kind="read_lints" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-fetch-rounded">
			<ToolKindIcon kind="fetch" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-web-search-rounded">
			<ToolKindIcon kind="web_search" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-browser-rounded">
			<ToolKindIcon kind="browser" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-sql-rounded">
			<ToolKindIcon kind="sql" size={12} />
		</span>
	</div>
	<div class="flex items-center gap-3 border border-border/40 p-2" data-testid="rounded-tool-kind-fallback-icons-fixture">
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-think-rounded">
			<ToolKindIcon kind="think" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-skill-rounded">
			<ToolKindIcon kind="skill" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-task-rounded">
			<ToolKindIcon kind="task" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-task-output-rounded">
			<ToolKindIcon kind="task_output" size={12} />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="tool-kind-other-rounded">
			<ToolKindIcon kind="other" size={12} />
		</span>
	</div>
	<div class="w-[280px] border border-border/40 p-2" data-testid="pr-check-neutral-css-icon-fixture">
		<PrChecksList checks={neutralPrChecks} initiallyExpanded={true} />
	</div>
	<div class="flex items-center gap-3 border border-border/40 p-2" data-testid="agent-input-mode-rounded-icons-fixture">
		<span class="inline-flex size-6 items-center justify-center" data-testid="mode-plan-rounded">
			<AgentInputModeIcon iconKind="plan" class="size-3.5 shrink-0" />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="mode-autonomous-rounded">
			<AgentInputModeIcon iconKind="autonomous" class="size-3.5 shrink-0" />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="mode-bypass-rounded">
			<AgentInputModeIcon iconKind="bypass" class="size-3.5 shrink-0" />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="mode-ask-rounded">
			<AgentInputModeIcon iconKind="ask" class="size-3.5 shrink-0" />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="mode-edit-rounded">
			<AgentInputModeIcon iconKind="edit" class="size-3.5 shrink-0" />
		</span>
		<span class="inline-flex size-6 items-center justify-center" data-testid="mode-review-rounded">
			<AgentInputModeIcon iconKind="review" class="size-3.5 shrink-0" />
		</span>
	</div>
	<div class="flex items-center gap-3 border border-border/40 p-2" data-testid="brain-mic-rounded-icons-fixture">
		<AgentInputMicButton title="Record" ariaLabel="Record" />
		<div class="w-[180px]">
			<AgentToolThinking
				headerLabel="Thought"
				collapsed={true}
				defaultExpanded={false}
				onToggleDefaultExpand={() => {}}
			/>
		</div>
	</div>
	<div class="flex items-center gap-3 border border-border/40 p-2" data-testid="rounded-file-text-icon-fixture">
		<RoundedIcon name="file-text" class="size-4 text-muted-foreground" data-testid="file-text-rounded-icon" />
	</div>
	<div class="flex items-center gap-3 border border-border/40 p-2" data-testid="todo-rounded-state-icons-fixture">
		<span class="inline-flex size-5 items-center justify-center" data-testid="todo-pending-icon">
			<TodoNumberIcon status="pending" size={14} />
		</span>
		<span class="inline-flex size-5 items-center justify-center" data-testid="todo-live-spinner-icon">
			<TodoNumberIcon status="in_progress" isLive={true} size={14} />
		</span>
	</div>
	<div class="w-[340px] border border-border/40 p-2" data-testid="partial-review-row-fixture">
		<AgentPanelModifiedFileRow file={partialReviewFile} isSelected={false} />
	</div>
	<div class="w-[360px] border border-border/40 p-2" data-testid="agent-tool-question-css-square-fixture">
		<AgentToolQuestion
			questions={multiSelectQuestionFixture}
			isInteractive={true}
			selectedLabels={multiSelectQuestionSelectedLabels}
			hasSelections={true}
			onSelect={() => {}}
			onOtherInput={() => {}}
			onOtherKeydown={() => {}}
			onSubmit={() => {}}
			onCancel={() => {}}
		/>
	</div>
	<div class="w-[360px] border border-border/40 p-2" data-testid="pre-session-worktree-failure-fixture">
		<AgentPanelPreSessionWorktreeCard
			pendingWorktreeEnabled={true}
			failureMessage="Setup failed"
			onYes={() => {}}
			onNo={() => {}}
			onDismiss={() => {}}
			onRetry={() => {}}
		/>
	</div>
	<div class="w-[300px] border border-border/40 p-2" data-testid="feed-section-code-fixture">
		<SectionedFeed groups={codeFeedGroups} totalCount={1} expanded={true}>
			{#snippet itemRenderer(_item)}
				<div class="px-2 py-1 text-[10px] text-muted-foreground">Review item</div>
			{/snippet}
		</SectionedFeed>
	</div>
	<div class="w-[300px] border border-border/40 p-2" data-testid="feed-section-eye-fixture">
		<FeedSectionHeader sectionId="needs_review" label="Needs review" count={1} color="#88c0d0" />
	</div>
	<div class="w-[300px] border border-border/40 p-2" data-testid="feed-section-pulse-fixture">
		<FeedSectionHeader sectionId="working" label="Working" count={2} color="#15DB95" />
		<FeedSectionHeader sectionId="planning" label="Planning" count={1} color="#F6A04D" />
	</div>
	<div class="h-[240px] w-[260px] border border-border/40" data-testid="sql-studio-sidebar-fixture">
		<SqlStudioSidebar
			connections={sqlStudioConnections}
			selectedConnectionId="fixture-sqlite"
			schema={sqlStudioSchema}
			selectedSchemaName="public"
			selectedTableName="users"
			onConnectionSelect={() => {}}
			onConnectionCreate={() => {}}
			onConnectionDelete={() => {}}
			onTableSelect={() => {}}
		/>
	</div>
	<div class="h-[190px] w-[360px] border border-border/40 p-2" data-testid="kanban-plan-approval-code-fixture">
		<KanbanSceneBoard groups={codeKanbanGroups} />
	</div>
	<div class="w-[520px] border border-border/40 p-2" data-testid="review-header-fixture">
		<ReviewWorkspaceHeader
			label="Review"
			fileCount={3}
			selectedFileIndex={1}
			onPreviousFile={() => {}}
			onNextFile={() => {}}
			onClose={() => {}}
		>
			{#snippet headerActions()}
				<Button
					variant="ghost"
					size="icon"
					active
					aria-label="Split diff"
					title="Split diff"
					data-testid="review-header-diff-style-split"
				>
					<RoundedIcon name="git-diff" />
				</Button>
			{/snippet}
		</ReviewWorkspaceHeader>
	</div>
	<div class="w-[520px]" data-testid="agent-tool-search-fixture">
		<AgentToolSearch
			query="RoundedIcon"
			files={["packages/ui/src/components/icons/rounded-icon.svelte"]}
			resultCount={3}
		/>
	</div>
</div>
