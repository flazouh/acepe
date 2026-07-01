<script lang="ts">
import { Button, DiscordIcon, RoundedIcon, XLogoIcon } from "@acepe/ui";
import { SidebarUpdateCard, type SidebarUpdateKind } from "@acepe/ui/app-layout";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onMount } from "svelte";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { UpdaterBannerState } from "../../logic/updater-state.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";

interface Props {
	state: MainAppViewState;
	projectManager: ProjectManager;
	onOpenGitPanel?: (projectPath: string) => void;
	updaterState?: UpdaterBannerState;
	onUpdateClick?: () => void;
	onRetryUpdateClick?: () => void;
}

let {
	state: appState,
	projectManager,
	onOpenGitPanel,
	updaterState,
	onUpdateClick,
	onRetryUpdateClick,
}: Props = $props();

const chromeIconButton = { variant: "ghost" as const, size: "icon-chrome" as const };

const updateCardKind = $derived<SidebarUpdateKind | null>(
	updaterState?.kind === "available" ||
		updaterState?.kind === "downloading" ||
		updaterState?.kind === "installing" ||
		updaterState?.kind === "error"
		? updaterState.kind
		: null
);

const updateCardVersion = $derived(
	updaterState?.kind === "available" ||
		updaterState?.kind === "downloading" ||
		updaterState?.kind === "installing"
		? updaterState.version
		: null
);

const updateCardPercent = $derived(
	updaterState?.kind === "installing"
		? 100
		: updaterState?.kind === "downloading" && updaterState.totalBytes && updaterState.totalBytes > 0
			? Math.min(Math.round((updaterState.downloadedBytes / updaterState.totalBytes) * 100), 100)
			: 0
);

function handleUpdateCardClick() {
	if (updaterState?.kind === "error") {
		onRetryUpdateClick?.();
		return;
	}
	onUpdateClick?.();
}

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

<div class="shrink-0 flex flex-col">
{#if updateCardKind !== null}
	<div class="px-2 pt-1.5">
		<SidebarUpdateCard
			kind={updateCardKind}
			version={updateCardVersion}
			percent={updateCardPercent}
			onclick={handleUpdateCardClick}
		/>
	</div>
{/if}
<div class="px-2 py-1.5 flex items-center gap-0.5">
	<div class="flex items-center gap-0.5">
		<Button
			{...chromeIconButton}
			title="GitHub"
			aria-label="GitHub"
			onclick={() => openUrl("https://github.com/flazouh/acepe")}
		>
			{#snippet children()}
				<RoundedIcon name="github" class="size-4" />
			{/snippet}
		</Button>
		<Button
			{...chromeIconButton}
			title="X"
			aria-label="X"
			onclick={() => openUrl("https://x.com/acepedotdev")}
		>
			{#snippet children()}
				<XLogoIcon class="size-4" />
			{/snippet}
		</Button>
		<Button
			{...chromeIconButton}
			title="Discord"
			aria-label="Discord"
			onclick={() => openUrl("https://discord.gg/5YhW7T7qhS")}
		>
			{#snippet children()}
				<DiscordIcon class="size-4" weight="fill" />
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
</div>
