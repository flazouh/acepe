<script lang="ts">
import { EmbeddedIconButton } from "@acepe/ui";
import Sparkle from "phosphor-svelte/lib/Sparkle";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";

interface Props {
	state: MainAppViewState;
	projectManager: ProjectManager;
	collapsed?: boolean;
}

let { state: appState, projectManager: _projectManager, collapsed = false }: Props = $props();

let appVersion = $state<string | null>(null);
$effect(() => {
	void import("@tauri-apps/api/app")
		.then((mod) => mod.getVersion())
		.then((v) => {
			appVersion = v;
		});
});
</script>

{#if collapsed}
	<div class="shrink-0 flex items-center justify-center py-1">
		<Tooltip.Root>
			<Tooltip.Trigger>
				<EmbeddedIconButton
					title="What's New"
					ariaLabel="What's New"
					class="transition-colors duration-200 hover:bg-accent/50"
					onclick={() => appState.openChangelog()}
				>
					<Sparkle weight="fill" class="size-3" />
				</EmbeddedIconButton>
			</Tooltip.Trigger>
			<Tooltip.Content>
				<span>{appVersion ? `What's New - v${appVersion}` : "What's New"}</span>
			</Tooltip.Content>
		</Tooltip.Root>
	</div>
{:else}
	<div class="shrink-0 px-3 py-1.5 flex items-center gap-1">
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
{/if}
