<script lang="ts">
import { GitPanel } from "$lib/acp/components/git-panel/index.js";
import ProjectSelector from "$lib/acp/components/project-selector.svelte";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import { resolveCurrentWorktree } from "$lib/acp/store/git-modal-state.js";
import type { WorktreeInfo } from "$lib/acp/types/worktree-info.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { RoundedIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Tree } from "phosphor-svelte";

interface Props {
	projectManager: ProjectManager;
}

let { projectManager }: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();

const gitDialog = $derived(panelStore.gitDialog);
let worktrees = $state<WorktreeInfo[]>([]);
let worktreeMenuOpen = $state(false);

function handleOpenChange(open: boolean) {
	if (!open) {
		panelStore.closeGitDialog();
	}
}

function handleRequestGeneration(projectPath: string, prompt: string) {
	const agentPanel = panelStore.getFirstSessionAgentPanelForProject(projectPath);
	if (agentPanel?.sessionId) {
		sessionStore.connection.sendMessage(agentPanel.sessionId, prompt);
	}
}

function switchWorktree(directory: string): void {
	worktreeMenuOpen = false;
	panelStore.openGitDialog(directory);
}
</script>

{#if gitDialog}
	{@const activeGitDialog = gitDialog}
	{@const project = projectManager.getProject(activeGitDialog.projectPath) ?? null}
	{@const projectName =
		project?.name ??
		activeGitDialog.projectPath.split("/").pop() ??
		activeGitDialog.projectPath}
	{@const currentWorktree = resolveCurrentWorktree(activeGitDialog.projectPath, worktrees)}
	<DialogFrame
		open={true}
		title="Source Control — {projectName}"
		closeLabel="Close source control"
		contentOverflow="hidden"
		contentClass="!bg-background !rounded-lg"
		onOpenChange={handleOpenChange}
	>
		{#snippet topLeft()}
			<div class="flex min-w-0 items-center gap-1.5">
				<ProjectSelector
					selectedProject={project}
					recentProjects={projectManager.projects}
					labelByPath={projectManager.badgeLabelByPath}
					onProjectChange={(nextProject) => panelStore.openGitDialog(nextProject.path)}
					showLabel
				/>
				{#if worktrees.length > 1}
					<Selector
						bind:open={worktreeMenuOpen}
						align="start"
						side="bottom"
						sideOffset={4}
						variant="ghost"
						showChevron={true}
						triggerAriaLabel="Switch worktree"
						triggerClass="!h-6 gap-1.5 rounded-md px-1.5 text-xs font-normal text-muted-foreground hover:bg-accent/50 hover:text-foreground"
						contentClass="p-0.5"
					>
						{#snippet renderButton()}
							<Tree size={13} weight="fill" class="shrink-0 text-success" />
							<span class="max-w-[10rem] truncate text-foreground">
								{currentWorktree ? currentWorktree.name : projectName}
							</span>
						{/snippet}

						<DropdownMenu.Label
							class="border-b-0 px-1.5 py-0.5 text-[0.625rem] leading-none font-normal text-muted-foreground"
						>
							Worktree
						</DropdownMenu.Label>
						{#each worktrees as worktree (worktree.directory)}
							{@const isCurrent = worktree.directory === activeGitDialog.projectPath}
							<DropdownMenu.Item
								onSelect={() => switchWorktree(worktree.directory)}
								class="cursor-pointer gap-1.5 rounded-sm !px-1.5 !py-1 text-xs"
							>
								<div class="flex w-full min-w-[10rem] items-center gap-1.5">
									<Tree
										size={12}
										weight={isCurrent ? "fill" : "regular"}
										class={isCurrent ? "shrink-0 text-success" : "shrink-0 text-muted-foreground"}
									/>
									<span class="min-w-0 flex-1 truncate text-foreground">{worktree.name}</span>
									{#if worktree.origin === "external"}
										<span class="shrink-0 text-[0.625rem] uppercase tracking-wide text-muted-foreground/60">
											ext
										</span>
									{/if}
									<RoundedIcon
										name="check"
										class={isCurrent
											? "size-[11px] shrink-0 text-foreground"
											: "size-[11px] shrink-0 text-transparent"}
									/>
								</div>
							</DropdownMenu.Item>
						{/each}
					</Selector>
				{/if}
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
					onWorktreesLoaded={(loaded) => (worktrees = loaded)}
					onRequestGeneration={(prompt) =>
						handleRequestGeneration(activeGitDialog.projectPath, prompt)}
				/>
			</div>
		{/key}
	</DialogFrame>
{/if}
