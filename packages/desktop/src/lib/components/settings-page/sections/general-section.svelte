<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { invoke } from "@tauri-apps/api/core";
import Check from "phosphor-svelte/lib/Check";
import Warning from "phosphor-svelte/lib/Warning";
import { ThemeToggle } from "$lib/components/theme/index.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import { getLocale, setLocale } from "$lib/i18n/store.svelte.js";
import { getLanguageMetadata } from "$lib/i18n/utils.js";
import * as m from "$lib/paraglide/messages.js";
import { getNotificationPreferencesStore } from "$lib/stores/notification-preferences-store.svelte.js";
import SettingsControlCard from "../settings-control-card.svelte";
import SettingsSection from "../settings-section.svelte";
import SettingsSectionHeader from "../settings-section-header.svelte";

const notifPrefs = getNotificationPreferencesStore();

const languages = getLanguageMetadata();
let currentLocale = $state(getLocale());
const currentLanguage = $derived(languages.find((language) => language.code === currentLocale));

function handleLanguageSelect(languageCode: string) {
	currentLocale = languageCode as typeof currentLocale;
	setLocale(languageCode as typeof currentLocale);
}

let showResetConfirm = $state(false);

async function handleResetDatabase() {
	await invoke("reset_database");
	showResetConfirm = false;
}
</script>

<div class="w-full">
	<SettingsSection
		title={m.settings_appearance()}
		description="Choose how Acepe looks and which language it uses."
	>
		<SettingsControlCard
			label={m.settings_theme()}
			description="Use light, dark, or match your system."
		>
			<ThemeToggle />
		</SettingsControlCard>
		<SettingsControlCard
			label={m.settings_language()}
			description="Choose the display language."
		>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							variant="outline"
							class="h-8 min-w-[220px] justify-between text-left text-[13px]"
							{...props}
						>
							<span class="truncate">
								{#if currentLanguage}
									{currentLanguage.name} ({currentLanguage.nativeName})
								{:else}
									Select language
								{/if}
							</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-[280px]">
					{#each languages as language (language.code)}
						<DropdownMenu.Item onclick={() => handleLanguageSelect(language.code)}>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<Check
									class={language.code === currentLocale
										? "size-3.5 text-foreground"
										: "size-3.5 text-transparent"}
									weight="bold"
								/>
								<div class="min-w-0">
									<div class="truncate text-[13px]">{language.name}</div>
									<div class="truncate text-[12px] text-muted-foreground/60">
										{language.nativeName}
									</div>
								</div>
							</div>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</SettingsControlCard>
	</SettingsSection>

	<SettingsSection
		title="Notifications"
		description="Control when Acepe should surface important activity."
	>
		<SettingsControlCard
			label="Questions & permissions"
			description="Show a popup when an agent needs input while the app is unfocused."
		>
			<Switch
				checked={notifPrefs.questionsEnabled}
				onCheckedChange={(checked) => {
					notifPrefs.setQuestionsEnabled(checked === true);
				}}
			/>
		</SettingsControlCard>
		<SettingsControlCard
			label="Task completions"
			description="Show a popup when an agent finishes a task while the app is unfocused."
		>
			<Switch
				checked={notifPrefs.completionsEnabled}
				onCheckedChange={(checked) => {
					notifPrefs.setCompletionsEnabled(checked === true);
				}}
			/>
		</SettingsControlCard>
	</SettingsSection>

	<!-- Danger Zone -->
	<div class="mt-16">
		<SettingsSectionHeader
			title={m.settings_danger_zone()}
			description="Reset local app data and start fresh."
		/>
		<div class="overflow-hidden rounded-sm border border-destructive/30 bg-muted/30">
			<div class="flex items-center justify-between px-5 py-4">
				<div class="flex items-center gap-2 min-w-0">
					<Warning class="size-3.5 text-destructive shrink-0" weight="fill" />
					<div class="min-w-0">
						<p class="text-[13px] font-medium">{m.settings_reset_database()}</p>
						<p class="text-[12px] text-muted-foreground/60">
							{m.settings_reset_database_description()}
						</p>
					</div>
				</div>
				<button
					type="button"
					class="shrink-0 rounded-md bg-destructive px-2 py-1 text-[12px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
					onclick={() => (showResetConfirm = true)}
				>
					{m.settings_reset_database()}
				</button>
			</div>
		</div>
	</div>
</div>

<!-- Reset Database Confirmation Dialog -->
<AlertDialog.Root bind:open={showResetConfirm}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{m.settings_reset_database_confirm_title()}</AlertDialog.Title>
			<AlertDialog.Description>
				{m.settings_reset_database_confirm_description()}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				onclick={handleResetDatabase}
			>
				{m.settings_reset_database_reset_button()}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
