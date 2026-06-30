<script lang="ts">
import { Button } from "@acepe/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DiscordLogo, GithubLogo } from "phosphor-svelte";
import { onMount } from "svelte";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";

interface Props {
	state: MainAppViewState;
	projectManager: ProjectManager;
	onOpenGitPanel?: (projectPath: string) => void;
}

let { state: appState, projectManager, onOpenGitPanel }: Props = $props();

const chromeIconButton = { variant: "ghost" as const, size: "icon-chrome" as const };

let appVersion = $state<string | null>(null);

onMount(() => {
	void import("@tauri-apps/api/app")
		.then((mod) => mod.getVersion())
		.then((v) => {
			appVersion = v;
		})
		.catch(() => {
			appVersion = null;
		});
});

const releaseUrl = $derived(
	appVersion ? `https://github.com/flazouh/acepe/releases/tag/v${appVersion}` : null
);
</script>

<div class="shrink-0 px-2 py-1.5 flex items-center gap-0.5">
	<div class="flex items-center gap-0.5">
		<Button
			{...chromeIconButton}
			title="GitHub"
			aria-label="GitHub"
			onclick={() => openUrl("https://github.com/flazouh/acepe")}
		>
			{#snippet children()}
				<GithubLogo class="size-4" weight="fill" />
			{/snippet}
		</Button>
		<Button
			{...chromeIconButton}
			title="X"
			aria-label="X"
			onclick={() => openUrl("https://x.com/acepedotdev")}
		>
			{#snippet children()}
				<svg viewBox="0 0 24 24" aria-hidden="true" class="size-4 fill-current">
					<path
						d="M18.244 2H21.5l-7.1 8.117L22 22h-5.956l-4.663-6.104L6.04 22H2.78l7.594-8.68L2 2h6.108l4.215 5.56L18.244 2Zm-1.143 18h1.804L5.128 3.895H3.193L17.1 20Z"
					/>
				</svg>
			{/snippet}
		</Button>
		<Button
			{...chromeIconButton}
			title="Discord"
			aria-label="Discord"
			onclick={() => openUrl("https://discord.gg/5YhW7T7qhS")}
		>
			{#snippet children()}
				<DiscordLogo class="size-4" style="color: #6C75E8" weight="fill" />
			{/snippet}
		</Button>
	</div>
	{#if releaseUrl}
		<Button
			variant="ghost"
			class="ml-auto h-auto min-h-0 gap-0 p-0 text-[9px] font-normal text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground"
			title={`Open release notes for v${appVersion}`}
			onclick={() => openUrl(releaseUrl)}
		>
			{#snippet children()}
				v{appVersion}
			{/snippet}
		</Button>
	{/if}
</div>
