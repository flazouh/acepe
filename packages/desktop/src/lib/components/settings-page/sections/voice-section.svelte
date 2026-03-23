<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";

import { Button } from "$lib/components/ui/button/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/paraglide/messages.js";
import { getVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";

const voiceSettingsStore = getVoiceSettingsStore();

const selectedLanguageLabel = $derived.by(() => {
	if (voiceSettingsStore.language === "auto") {
		return m.voice_settings_auto_detect();
	}

	const selectedLanguage =
		voiceSettingsStore.languages.find((language) => language.code === voiceSettingsStore.language) ??
		null;

	return selectedLanguage ? selectedLanguage.name : m.voice_settings_auto_detect();
});

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	return `${Math.round(bytes / (1024 * 1024))} MB`;
}
</script>

<div class="w-full text-sm">
	<SettingsSection title={m.settings_voice()}>
		<SettingRow
			label={m.voice_settings_enable_label()}
			description={m.voice_settings_enable_description()}
		>
		<Switch
			checked={voiceSettingsStore.enabled}
			onCheckedChange={(checked) => {
					void voiceSettingsStore.setEnabled(checked === true);
				}}
			/>
		</SettingRow>
		<SettingRow
			label={m.voice_settings_language_label()}
			description={m.voice_settings_language_description()}
		>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							variant="outline"
							class="h-8 min-w-[220px] justify-between text-left text-sm"
							{...props}
						>
							<span class="truncate">{selectedLanguageLabel}</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-[240px]">
					<DropdownMenu.Item onclick={() => void voiceSettingsStore.setLanguage("auto")}>
						{m.voice_settings_auto_detect()}
					</DropdownMenu.Item>
					{#each voiceSettingsStore.languages as language (language.code)}
						<DropdownMenu.Item onclick={() => void voiceSettingsStore.setLanguage(language.code)}>
							{language.name}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</SettingRow>
	</SettingsSection>

	<SettingsSection title={m.voice_settings_models_title()}>
		{#if voiceSettingsStore.modelsLoading}
			<div class="px-3 py-2 text-sm text-muted-foreground/60">
				{m.voice_settings_loading_models()}
			</div>
		{:else}
			<div role="radiogroup" aria-label={m.voice_settings_models_title()}>
			{#each voiceSettingsStore.models as model (model.id)}
				<div class="px-3 py-2 border-b border-border/30 last:border-b-0">
					<div class="flex items-start gap-3">
						<button
							type="button"
							role="radio"
							aria-checked={voiceSettingsStore.selectedModelId === model.id}
							class="flex min-w-0 flex-1 items-start gap-3 text-left"
							onclick={() => void voiceSettingsStore.setSelectedModelId(model.id)}
						>
							<div
								class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
								class:border-foreground={voiceSettingsStore.selectedModelId === model.id}
								class:border-border={voiceSettingsStore.selectedModelId !== model.id}
							>
								{#if voiceSettingsStore.selectedModelId === model.id}
									<div class="h-2 w-2 rounded-full bg-foreground"></div>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate text-sm font-medium text-foreground">{model.name}</span>
									<span class="text-xs text-muted-foreground/60">{formatBytes(model.size_bytes)}</span>
								</div>
								<div class="mt-0.5 text-xs text-muted-foreground/60">
									{#if model.is_english_only}
										{m.voice_settings_model_english_only()}
									{:else}
										{m.voice_settings_model_multilingual()}
									{/if}
								</div>
							</div>
						</button>
						<div class="shrink-0">
							{#if voiceSettingsStore.downloadProgressModelId === model.id}
								<div class="min-w-[120px]">
									<div class="text-[11px] text-muted-foreground/60">
										{Math.round(voiceSettingsStore.downloadPercent)}%
									</div>
									<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
										<div
											class="h-full rounded-full bg-primary transition-all duration-200"
											style={`width: ${voiceSettingsStore.downloadPercent}%`}
										></div>
									</div>
								</div>
							{:else if model.is_downloaded}
								{#if voiceSettingsStore.selectedModelId === model.id}
									<span class="text-xs font-medium text-foreground/80">
										{m.voice_settings_selected()}
									</span>
								{:else}
									<Button
										variant="outline"
										class="h-8 px-3 text-xs"
										onclick={() => void voiceSettingsStore.deleteModel(model.id)}
									>
										{m.voice_settings_delete()}
									</Button>
								{/if}
							{:else}
								<Button
									variant="outline"
									class="h-8 px-3 text-xs"
									onclick={() => void voiceSettingsStore.downloadModel(model.id)}
								>
									{m.voice_settings_download()}
								</Button>
							{/if}
						</div>
					</div>
				</div>
			{/each}
			</div>
		{/if}
	</SettingsSection>
</div>
