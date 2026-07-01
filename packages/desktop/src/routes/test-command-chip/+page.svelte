<script lang="ts">
import {
	AgentToolSearch,
	CommandChip,
	ReviewWorkspaceHeader,
	type CommandChipModel,
} from "@acepe/ui/agent-panel";
import { GitWorkspace, type GitRemoteStatus } from "@acepe/ui/git-panel";
import ProjectCard from "$lib/acp/components/project-card.svelte";
import type { ProjectCardData } from "$lib/acp/components/project-card-data.js";

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
</script>

<div class="h-screen w-screen space-y-4 overflow-auto bg-background p-4">
	<div class="max-w-[600px]" data-testid="command-chip-fixture">
		<CommandChip model={modelCommandChip} />
	</div>
	<div class="w-[320px]" data-testid="project-card-fixture">
		<ProjectCard data={projectCardData} index={0} onSelect={() => {}} />
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
