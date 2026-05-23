<script lang="ts">
import { GitPanel } from "$lib/acp/components/git-panel/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import WorkspaceDialogFrame from "$lib/components/ui/workspace-dialog-frame.svelte";

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
	const agentPanel = panelStore.getFirstSessionAgentPanelForProject(projectPath);
	if (agentPanel?.sessionId) {
		sessionStore.sendMessage(agentPanel.sessionId, prompt);
	}
}
</script>

{#if gitDialog}
	{@const activeGitDialog = gitDialog}
	{@const project = projectManager.getProject(activeGitDialog.projectPath) ?? null}
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
