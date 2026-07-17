<script lang="ts">
import { Button, HugeiconsIcon } from "@acepe/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onMount } from "svelte";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import {
	getUpdateButtonModel,
	type UpdaterBannerState,
} from "../../logic/updater-state.js";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";

interface Props {
	state: MainAppViewState;
	projectManager: ProjectManager;
	updaterState?: UpdaterBannerState;
	onUpdateClick?: () => void;
	onRetryUpdateClick?: () => void;
}

let {
	state: appState,
	projectManager,
	updaterState,
	onUpdateClick,
	onRetryUpdateClick,
}: Props = $props();

const chromeIconButton = { variant: "ghost" as const, size: "icon" as const };
const updateButtonModel = $derived(
	updaterState ? getUpdateButtonModel(updaterState) : null
);

function handleUpdateButtonClick(): void {
	if (updateButtonModel?.kind === "error") {
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
<div class="px-2 py-1.5 flex items-center gap-0.5">
	<div class="flex items-center gap-0.5">
		<Button
			{...chromeIconButton}
			title="GitHub"
			aria-label="GitHub"
			onclick={() => openUrl("https://github.com/flazouh/acepe")}
		>
			{#snippet children()}
				<HugeiconsIcon name="github-filled" size={16} filled />
			{/snippet}
		</Button>
		<Button
			{...chromeIconButton}
			title="X"
			aria-label="X"
			onclick={() => openUrl("https://x.com/acepedotdev")}
		>
			{#snippet children()}
				<HugeiconsIcon name="twitter-filled" size={16} filled />
			{/snippet}
		</Button>
		<Button
			{...chromeIconButton}
			title="Discord"
			aria-label="Discord"
			onclick={() => openUrl("https://discord.gg/5YhW7T7qhS")}
		>
			{#snippet children()}
				<HugeiconsIcon name="discord-filled" size={16} filled />
			{/snippet}
		</Button>
		{#if updateButtonModel}
			<Button
				size="xs"
				class="ml-0.5 h-6 rounded-md border-0 bg-white px-2 text-[10px] font-medium text-black shadow-sm hover:bg-white/90 hover:text-black disabled:opacity-70"
				disabled={updateButtonModel.disabled}
				aria-label={updateButtonModel.ariaLabel}
				title={updateButtonModel.ariaLabel}
				data-testid="sidebar-update-button"
				onclick={handleUpdateButtonClick}
			>
				{updateButtonModel.label}
			</Button>
		{/if}
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
