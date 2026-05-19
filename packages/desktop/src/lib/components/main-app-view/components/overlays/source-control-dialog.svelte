<script lang="ts">
import { GitPanel } from "$lib/acp/components/git-panel/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import WorkspaceDialogFrame from "$lib/components/ui/workspace-dialog-frame.svelte";
import { ProjectLetterBadge } from "@acepe/ui/project-letter-badge";

interface Props {
	projectManager: ProjectManager;
}

let { projectManager }: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();

const gitDialog = $derived(panelStore.gitDialog);
function handleOpenChange(open: boolean) {
	if (!open) {
		panelStore.closeGitDialog();
	}
}

function handleRequestGeneration(projectPath: string, prompt: string) {
	const agentPanel = panelStore.panels.find(
		(panel) => panel.projectPath === projectPath && panel.sessionId
	);
	if (agentPanel?.sessionId) {
		sessionStore.sendMessage(agentPanel.sessionId, prompt);
	}
}
</script>

{#if gitDialog}
	{@const activeGitDialog = gitDialog}
	{@const project =
		projectManager.projects.find(
			(candidate) => candidate.path === activeGitDialog.projectPath
		) ?? null}
	{@const projectName =
		project?.name ??
		activeGitDialog.projectPath.split("/").pop() ??
		activeGitDialog.projectPath}
	<WorkspaceDialogFrame
		open={true}
		title="Source Control — {projectName}"
		closeLabel="Close source control"
		contentOverflow="hidden"
		onOpenChange={handleOpenChange}
	>
		{#snippet topLeft()}
			<div class="flex min-w-0 items-center gap-1.5">
				<div
					class="flex h-5 shrink-0 items-center gap-1 rounded border border-border bg-muted/60 px-1.5 text-[11px]"
				>
					<ProjectLetterBadge
						name={projectName}
						color={project?.color ?? ""}
						iconSrc={project?.iconPath ?? null}
						size={14}
						fontSize={9}
					/>
					<span class="truncate font-medium text-foreground leading-none">
						{projectName}
					</span>
				</div>
			</div>
		{/snippet}

		{#key activeGitDialog.id}
			<div class="h-full min-h-0 w-full overflow-hidden">
				<GitPanel
					panelId={activeGitDialog.id}
					projectPath={activeGitDialog.projectPath}
					{projectName}
					projectColor={project?.color}
					projectIconSrc={project?.iconPath ?? null}
					width={activeGitDialog.width}
					initialTarget={activeGitDialog.initialTarget}
					voiceSessionId={activeGitDialog.id}
					isFullscreenEmbedded={true}
					hideProjectBadge={true}
					hideHeaderClose={true}
					onClose={() => panelStore.closeGitDialog()}
					onResize={() => undefined}
					onRequestGeneration={(prompt) =>
						handleRequestGeneration(activeGitDialog.projectPath, prompt)}
				/>
			</div>
		{/key}
	</WorkspaceDialogFrame>
{/if}
