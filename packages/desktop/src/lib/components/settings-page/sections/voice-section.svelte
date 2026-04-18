<script lang="ts">
import { VoiceDownloadProgress } from "@acepe/ui";
import { DownloadSimple, Microphone, Trash } from "phosphor-svelte";

import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/messages.js";
import { getVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";

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

<div class="w-full space-y-3">
	<SettingsSectionHeader
		title={m.settings_voice()}
		description={m.voice_settings_enable_description()}
	/>

	<!-- Voice enable card -->
	<div class="overflow-hidden rounded-lg bg-muted/20 shadow-sm">
		<div class="flex items-center h-9 px-3 gap-2">
			<Microphone class="size-3.5 shrink-0 text-muted-foreground" weight="fill" />
			<span class="flex-1 truncate text-[13px] font-medium text-foreground">
				{m.voice_settings_enable_label()}
			</span>
			<Switch
				checked={voiceSettingsStore.enabled}
				onCheckedChange={(checked) => {
					void voiceSettingsStore.setEnabled(checked === true);
				}}
			/>
		</div>
		{#if selectedModelIsEnglishOnly}
			<div class="flex items-center h-8 px-3 border-t border-border/40 text-[12px] text-muted-foreground">
				English-only model uses English transcription.
			</div>
		{/if}
	</div>

	<!-- Models card -->
	<div class="overflow-hidden rounded-lg bg-muted/20 shadow-sm">
		<div class="flex items-center h-9 px-3 gap-2">
			<div class="size-3.5 shrink-0 rounded-sm bg-muted-foreground/20 flex items-center justify-center">
				<span class="text-[8px] font-bold text-muted-foreground">AI</span>
			</div>
			<span class="flex-1 truncate text-[13px] font-medium text-foreground">
				{m.voice_settings_models_title()}
			</span>
		</div>

		{#if voiceSettingsStore.modelsLoading}
			<div class="flex items-center h-8 px-3 border-t border-border/40 text-[12px] text-muted-foreground">
				{m.voice_settings_loading_models()}
			</div>
		{:else}
			<div role="radiogroup" aria-label={m.voice_settings_models_title()}>
				{#each voiceSettingsStore.models as model (model.id)}
					{@const isSelected = voiceSettingsStore.selectedModelId === model.id}
					{@const isDownloading = voiceSettingsStore.downloadProgressModelId === model.id}

					<div class="flex items-center gap-2 h-8 w-full px-3 border-t border-border/40">
						<button
							type="button"
							role="radio"
							aria-checked={isSelected}
							class="flex items-center gap-2 flex-1 min-w-0 h-full text-left hover:bg-accent/50 -mx-3 px-3 transition-colors"
							onclick={() => void voiceSettingsStore.setSelectedModelId(model.id)}
						>
							<div
								class="flex h-3 w-3 shrink-0 items-center justify-center rounded-full border {isSelected ? 'border-foreground' : 'border-muted-foreground/40'}"
							>
								{#if isSelected}
									<div class="h-1.5 w-1.5 rounded-full bg-foreground"></div>
								{/if}
							</div>

							<span
								class="truncate text-[13px] font-medium {isSelected ? 'text-foreground' : 'text-foreground/80'}"
							>
								{model.name}
							</span>

							<span class="text-[12px] text-muted-foreground">
								{#if model.is_english_only}
									EN
								{:else}
									{m.voice_settings_model_multilingual()}
								{/if}
							</span>

							<span class="ml-auto text-[12px] text-muted-foreground">
								{formatBytes(model.size_bytes)}
							</span>
						</button>

						{#if isDownloading}
							<VoiceDownloadProgress
								ariaLabel={`Downloading ${model.name}`}
								compact={false}
								label=""
								percent={voiceSettingsStore.downloadPercent}
								segmentCount={20}
							/>
						{:else if model.is_downloaded}
							<button
								type="button"
								class="group flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive hover:bg-accent"
								title={m.voice_settings_delete()}
								onclick={() => void voiceSettingsStore.deleteModel(model.id)}
							>
								<Trash class="size-3 hidden group-hover:block" weight="fill" />
								<Trash class="size-3 block group-hover:hidden" weight="regular" />
							</button>
						{:else}
							<button
								type="button"
								class="group flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
								title={m.voice_settings_download()}
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
