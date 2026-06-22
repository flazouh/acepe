<script lang="ts">
import { VoiceDownloadProgress } from "@acepe/ui";
import { DownloadSimple, Trash } from "phosphor-svelte";

import { Switch } from "$lib/components/ui/switch/index.js";
import { getVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";

import SettingRow from "../setting-row.svelte";
import SettingsSectionHeader from "../settings-section-header.svelte";

const voiceSettingsStore = getVoiceSettingsStore();

const selectedModelIsEnglishOnly = $derived.by(() => {
	const selectedModel = voiceSettingsStore.selectedModel;
	if (!selectedModel) {
		return false;
	}

	return selectedModel.is_english_only;
});

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	return `${Math.round(bytes / (1024 * 1024))} MB`;
}
</script>

<div class="w-full space-y-8">
	<SettingRow label={"Enable voice dictation"}>
		<Switch
			checked={voiceSettingsStore.enabled}
			onCheckedChange={(checked) => {
				void voiceSettingsStore.setEnabled(checked === true);
			}}
		/>
	</SettingRow>
	{#if selectedModelIsEnglishOnly}
		<p class="pb-2 text-[12px] text-muted-foreground">
			English-only model uses English transcription.
		</p>
	{/if}

	<div class="space-y-3">
		<SettingsSectionHeader variant="subsection" title={"Speech models"} />

		{#if voiceSettingsStore.modelsLoading}
			<p class="py-2 text-[12px] text-muted-foreground">{"Loading voice models…"}</p>
		{:else}
			<div role="radiogroup" aria-label={"Speech models"}>
				{#each voiceSettingsStore.models as model (model.id)}
					{@const isSelected = voiceSettingsStore.selectedModelId === model.id}
					{@const isDownloading = voiceSettingsStore.downloadProgressModelId === model.id}

					<div class="flex items-center gap-2 border-b border-border/30 py-2.5 last:border-b-0">
						<button
							type="button"
							role="radio"
							aria-checked={isSelected}
							class="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
							onclick={() => void voiceSettingsStore.setSelectedModelId(model.id)}
						>
							<div
								class="flex h-3 w-3 shrink-0 items-center justify-center rounded-full border {isSelected
									? 'border-foreground'
									: 'border-muted-foreground/40'}"
							>
								{#if isSelected}
									<div class="h-1.5 w-1.5 rounded-full bg-foreground"></div>
								{/if}
							</div>

							<span
								class="truncate text-[13px] font-medium {isSelected
									? 'text-foreground'
									: 'text-foreground/80'}"
							>
								{model.name}
							</span>

							<span class="text-[12px] text-muted-foreground">
								{#if model.is_english_only}
									EN
								{:else}
									{"Multilingual"}
								{/if}
							</span>

							<span class="ml-auto text-[12px] text-muted-foreground">
								{formatBytes(model.size_bytes)}
							</span>
						</button>

						{#if isDownloading}
							<VoiceDownloadProgress
								ariaLabel={`Downloading ${model.name}`}
								label=""
								percent={voiceSettingsStore.downloadPercent}
								segmentCount={20}
								variant="download"
							/>
						{:else if model.is_downloaded}
							<button
								type="button"
								class="group flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
								title={"Delete"}
								onclick={() => void voiceSettingsStore.deleteModel(model.id)}
							>
								<Trash class="size-3 hidden group-hover:block" weight="fill" />
								<Trash class="size-3 block group-hover:hidden" weight="regular" />
							</button>
						{:else}
							<button
								type="button"
								class="group flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								title={"Download"}
								onclick={() => void voiceSettingsStore.downloadModel(model.id)}
							>
								<DownloadSimple class="size-3 hidden group-hover:block" weight="fill" />
								<DownloadSimple class="size-3 block group-hover:hidden" weight="regular" />
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
