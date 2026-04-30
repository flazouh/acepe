<script lang="ts">
import { GitPanel } from "$lib/acp/components/git-panel/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import * as Dialog from "@acepe/ui/dialog";

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

<Dialog.Root open={gitDialog !== null} onOpenChange={handleOpenChange}>
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
		<Dialog.Content
			class="flex h-[90vh] w-fit max-w-[96vw] items-center justify-center overflow-visible border-0 bg-transparent p-0 shadow-none"
			showCloseButton={false}
		>
			{#key activeGitDialog.id}
				<div class="h-full w-[min(1100px,96vw)] max-w-[1100px] min-w-0 overflow-hidden">
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
						onClose={() => panelStore.closeGitDialog()}
						onResize={() => undefined}
						onRequestGeneration={(prompt) =>
							handleRequestGeneration(activeGitDialog.projectPath, prompt)}
					/>
				</div>
			{/key}
		</Dialog.Content>
	{/if}
</Dialog.Root>
