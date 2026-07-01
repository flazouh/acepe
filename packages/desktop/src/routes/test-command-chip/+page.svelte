<script lang="ts">
import {
	AgentInputAttachMenu,
	AgentInputSlashCommandDropdown,
	type AttachMenuCommandSection,
	AgentToolSearch,
	AgentToolSkill,
	AgentCompactToolDisplay,
	CommandChip,
	ReviewWorkspaceHeader,
	type SlashPaletteSection,
	type CommandChipModel,
} from "@acepe/ui/agent-panel";
import { GitWorkspace, type GitRemoteStatus } from "@acepe/ui/git-panel";
import ProjectCard from "$lib/acp/components/project-card.svelte";
import type { ProjectCardData } from "$lib/acp/components/project-card-data.js";
import type { SessionSummary } from "$lib/acp/application/dto/session-summary.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
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
			worktreePath: null,
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
</script>

<div class="h-screen w-screen space-y-4 overflow-auto bg-background p-4">
	<div class="max-w-[600px]" data-testid="command-chip-fixture">
		<CommandChip model={modelCommandChip} />
	</div>
	<div class="w-[320px]" data-testid="project-card-fixture">
		<ProjectCard data={projectCardData} index={0} onSelect={() => {}} />
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
	<div class="h-[360px] w-[760px] border border-border/40 p-2" data-testid="session-table-fixture">
		<SessionTable sessions={sessionTableSessions} projects={sessionTableProjects} loading={false} />
	</div>
	<div class="h-[320px] w-[760px] border border-border/40" data-testid="git-workspace-fixture">
		<GitWorkspace
			branch="main"
			remoteStatus={gitRemoteStatus}
			activeSection="changes"
			onSectionChange={() => {}}
			activeView="status"
			onViewChange={() => {}}
			stagedFiles={[]}
			unstagedFiles={[]}
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
	<div class="w-[240px] border border-border/40 p-2" data-testid="settings-sidebar-fixture">
		<SettingsSidebar
			activeSection={activeSettingsSection}
			onSectionChange={() => {}}
		/>
	</div>
	<div class="w-[520px] border border-border/40 p-2" data-testid="review-header-fixture">
		<ReviewWorkspaceHeader
			label="Review"
			fileCount={3}
			selectedFileIndex={1}
			onPreviousFile={() => {}}
			onNextFile={() => {}}
			onClose={() => {}}
		/>
	</div>
	<div class="w-[520px]" data-testid="agent-tool-search-fixture">
		<AgentToolSearch
			query="RoundedIcon"
			files={["packages/ui/src/components/icons/rounded-icon.svelte"]}
			resultCount={3}
		/>
	</div>
</div>
