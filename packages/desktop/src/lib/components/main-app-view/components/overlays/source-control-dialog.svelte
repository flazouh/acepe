<script lang="ts">
import { GitPanel } from "$lib/acp/components/git-panel/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";

interface Props {
	projectManager: ProjectManager;
}

let { projectManager }: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();

const gitDialog = $derived(panelStore.gitDialog);
const project = $derived.by(() => {
	if (gitDialog === null) {
		return null;
	}
	return (
		projectManager.projects.find((candidate) => candidate.path === gitDialog.projectPath) ?? null
	);
});
const projectName = $derived.by(() => {
	if (project?.name) {
		return project.name;
	}
	if (gitDialog === null) {
		return "";
	}
	const segments = gitDialog.projectPath.split("/");
	const lastSegment = segments[segments.length - 1];
	return lastSegment ? lastSegment : gitDialog.projectPath;
});
function handleOpenChange(open: boolean) {
	if (!open) {
		panelStore.closeGitDialog();
	}
}

function handleRequestGeneration(prompt: string) {
	if (gitDialog === null) {
		return;
	}
	const agentPanel = panelStore.panels.find(
		(panel) => panel.projectPath === gitDialog.projectPath && panel.sessionId
	);
	if (agentPanel?.sessionId) {
		sessionStore.sendMessage(agentPanel.sessionId, prompt);
	}
}
</script>

<Dialog.Root open={gitDialog !== null} onOpenChange={handleOpenChange}>
	{#if gitDialog}
		<Dialog.Content
			class="flex h-[90vh] w-fit max-w-[96vw] items-center justify-center overflow-visible border-0 bg-transparent p-0 shadow-none"
			showCloseButton={false}
		>
			{#key gitDialog.id}
				<div class="h-full w-[min(1100px,96vw)] max-w-[1100px] min-w-0 overflow-hidden">
					<GitPanel
						panelId={gitDialog.id}
						projectPath={gitDialog.projectPath}
						{projectName}
						projectColor={project?.color}
						width={gitDialog.width}
						initialTarget={gitDialog.initialTarget}
						voiceSessionId={gitDialog.id}
						isFullscreenEmbedded={true}
						hideProjectBadge={true}
						onClose={() => panelStore.closeGitDialog()}
						onResize={() => undefined}
						onRequestGeneration={handleRequestGeneration}
					/>
				</div>
			{/key}
		</Dialog.Content>
	{/if}
</Dialog.Root>
