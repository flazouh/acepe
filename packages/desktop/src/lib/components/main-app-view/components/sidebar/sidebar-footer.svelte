<script lang="ts">
import GitBranch from "phosphor-svelte/lib/GitBranch";
import Sparkle from "phosphor-svelte/lib/Sparkle";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";

interface Props {
	state: MainAppViewState;
	projectManager: ProjectManager;
	onOpenGitPanel?: (projectPath: string) => void;
}

let { state: appState, projectManager, onOpenGitPanel }: Props = $props();

let appVersion = $state<string | null>(null);
$effect(() => {
	void import("@tauri-apps/api/app")
		.then((mod) => mod.getVersion())
		.then((v) => {
			appVersion = v;
		});
});

const firstProjectPath = $derived(projectManager.projects[0]?.path ?? null);

function handleOpenGitPanel() {
	if (firstProjectPath) {
		onOpenGitPanel?.(firstProjectPath);
	}
}
</script>

<div class="shrink-0 px-3 py-1.5 flex items-center gap-2">
	{#if firstProjectPath && onOpenGitPanel}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					onclick={handleOpenGitPanel}
					class="text-muted-foreground/60 hover:text-foreground flex items-center gap-1 transition-colors"
					title="Source Control"
				>
					<GitBranch weight="fill" class="size-3.5" style="color: var(--color-purple, #9858FF)" />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Source Control</Tooltip.Content>
		</Tooltip.Root>
	{/if}
	<div class="flex items-center gap-1 ml-auto">
		{#if appVersion}
			<span class="text-[10px] text-muted-foreground/50">v{appVersion}</span>
		{/if}
		<button
			onclick={() => appState.openChangelog()}
			class="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"
			title="What's New"
		>
			<Sparkle weight="fill" class="size-3" />
			What's New
		</button>
	</div>
</div>
