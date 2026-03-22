<script lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { Warning } from "phosphor-svelte";
import { getPlanPreferenceStore } from "$lib/acp/store/plan-preference-store.svelte.js";
import { getReviewPreferenceStore } from "$lib/acp/store/review-preference-store.svelte.js";
import { ThemeToggle } from "$lib/components/theme/index.js";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/paraglide/messages.js";
import { getNotificationPreferencesStore } from "$lib/stores/notification-preferences-store.svelte.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";

const notifPrefs = getNotificationPreferencesStore();

let showResetConfirm = $state(false);

async function handleResetDatabase() {
	await invoke("reset_database");
	showResetConfirm = false;
}
</script>

<div class="w-full text-[11px]">
	<SettingsSection title={m.settings_appearance()}>
		<SettingRow label={m.settings_theme()} description="Use light, dark, or match your system">
			<ThemeToggle />
		</SettingRow>
	</SettingsSection>

	<SettingsSection title={m.modified_files_review_title()}>
		<SettingRow
			label={m.settings_review_prefer_fullscreen()}
			description={m.settings_review_prefer_fullscreen_description()}
		>
			<Switch
				checked={getReviewPreferenceStore().preferFullscreen}
				onCheckedChange={(checked) => {
					getReviewPreferenceStore().setPreferFullscreen(checked === true);
				}}
			/>
		</SettingRow>
	</SettingsSection>

	<SettingsSection title={m.settings_plans_title()}>
		<SettingRow
			label={m.settings_plans_prefer_inline()}
			description={m.settings_plans_prefer_inline_description()}
		>
			<Switch
				checked={getPlanPreferenceStore().preferInline}
				onCheckedChange={(checked) => {
					getPlanPreferenceStore().setPreferInline(checked === true);
				}}
			/>
		</SettingRow>
	</SettingsSection>

	<SettingsSection title="Notifications">
		<SettingRow
			label="Questions & permissions"
			description="Show popup when an agent needs input while the app is unfocused"
		>
			<Switch
				checked={notifPrefs.questionsEnabled}
				onCheckedChange={(checked) => {
					notifPrefs.setQuestionsEnabled(checked === true);
				}}
			/>
		</SettingRow>
		<SettingRow
			label="Task completions"
			description="Show popup when an agent finishes a task while the app is unfocused"
		>
			<Switch
				checked={notifPrefs.completionsEnabled}
				onCheckedChange={(checked) => {
					notifPrefs.setCompletionsEnabled(checked === true);
				}}
			/>
		</SettingRow>
	</SettingsSection>

	<!-- Danger Zone -->
	<div class="mt-6">
		<h3 class="text-[10px] font-semibold uppercase tracking-wider text-destructive/70 mb-2">
			{m.settings_danger_zone()}
		</h3>
		<div class="rounded-lg border border-destructive/30">
			<div class="px-2 py-1.5 flex items-center justify-between">
				<div class="flex items-center gap-2 min-w-0">
					<Warning class="size-3.5 text-destructive shrink-0" weight="fill" />
					<div class="min-w-0">
						<p class="text-[11px] font-medium">{m.settings_reset_database()}</p>
						<p class="text-[10px] text-muted-foreground/60">
							{m.settings_reset_database_description()}
						</p>
					</div>
				</div>
				<button
					type="button"
					class="shrink-0 px-2 py-1 text-[10px] font-medium text-destructive-foreground bg-destructive hover:bg-destructive/90 rounded-md transition-colors"
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
