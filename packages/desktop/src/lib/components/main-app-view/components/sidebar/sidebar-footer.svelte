<script lang="ts">
import Sparkle from "phosphor-svelte/lib/Sparkle";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";

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
</script>

<div class="shrink-0 px-3 py-1.5 flex items-center gap-2">
	<div class="flex items-center gap-1">
		<button
			onclick={() => appState.openChangelog()}
			class="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"
			title="What's New"
		>
			<Sparkle weight="fill" class="size-3" />
			What's New
		</button>
		{#if appVersion}
			<span class="text-[10px] text-muted-foreground/50">v{appVersion}</span>
		{/if}
	</div>
</div>
