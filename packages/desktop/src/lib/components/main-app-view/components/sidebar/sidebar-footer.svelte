<script lang="ts">
import { openUrl } from "@tauri-apps/plugin-opener";
import { DiscordLogo, GithubLogo } from "phosphor-svelte";
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

	const releaseUrl = $derived(
		appVersion ? `https://github.com/flazouh/acepe/releases/tag/v${appVersion}` : null
	);
</script>

<div class="shrink-0 px-2 py-1.5 flex items-center gap-0.5">
	<div class="flex items-center gap-0.5">
		<button
			class="flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
			title="GitHub"
			aria-label="GitHub"
			onclick={() => openUrl("https://github.com/flazouh/acepe")}
		>
			<GithubLogo class="size-3.5" weight="fill" />
		</button>
		<button
			class="flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
			title="X"
			aria-label="X"
			onclick={() => openUrl("https://x.com/acepedotdev")}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true" class="size-3 fill-current">
				<path
					d="M18.244 2H21.5l-7.1 8.117L22 22h-5.956l-4.663-6.104L6.04 22H2.78l7.594-8.68L2 2h6.108l4.215 5.56L18.244 2Zm-1.143 18h1.804L5.128 3.895H3.193L17.1 20Z"
				/>
			</svg>
		</button>
		<button
			class="flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
			title="Discord"
			aria-label="Discord"
			onclick={() => openUrl("https://discord.gg/5YhW7T7qhS")}
		>
			<DiscordLogo class="size-3.5" style="color: #6C75E8" weight="fill" />
		</button>
	</div>
	{#if releaseUrl}
		<button
			onclick={() => openUrl(releaseUrl)}
			class="ml-auto text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
			title={`Open release notes for v${appVersion}`}
		>
			v{appVersion}
		</button>
	{/if}
</div>
