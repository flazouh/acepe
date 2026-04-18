<script lang="ts">
import { Warning } from "phosphor-svelte";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/messages.js";
import { getAnalyticsPreferencesStore } from "$lib/stores/analytics-preferences-store.svelte.js";
import { getAttentionQueueStore } from "$lib/stores/attention-queue-store.svelte.js";
import { getNotificationPreferencesStore } from "$lib/stores/notification-preferences-store.svelte.js";
import { settings } from "$lib/utils/tauri-client/settings.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";
import SettingsSectionHeader from "../settings-section-header.svelte";

const notifPrefs = getNotificationPreferencesStore();
const attentionQueue = getAttentionQueueStore();
const analyticsPrefs = getAnalyticsPreferencesStore();

let showResetConfirm = $state(false);

async function handleResetDatabase() {
	await settings.resetDatabase().match(
		() => {
			showResetConfirm = false;
		},
		() => undefined
	);
}
</script>

<div class="w-full">
	<SettingsSection
		title="Notifications"
		description="Control when Acepe should surface important activity."
	>
		<SettingRow
			label="Questions & permissions"
			description="Show a popup when an agent needs input while the app is unfocused."
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
			description="Show a popup when an agent finishes a task while the app is unfocused."
		>
			<Switch
				checked={notifPrefs.completionsEnabled}
				onCheckedChange={(checked) => {
					notifPrefs.setCompletionsEnabled(checked === true);
				}}
			/>
		</SettingRow>
		<SettingRow
			label="Attention queue"
			description="Show an attention queue in the sidebar listing sessions that need your input or are actively working."
		>
			<Switch
				checked={attentionQueue.enabled}
				onCheckedChange={(checked) => {
					void attentionQueue.setEnabled(checked === true);
				}}
			/>
		</SettingRow>
	</SettingsSection>

	<SettingsSection
		title="Telemetry"
		description="Control anonymous usage and crash reporting."
	>
		<SettingRow
			label="Share anonymous usage data"
			description="Sends anonymous app-open events to PostHog and crash reports to Sentry. No code, prompts, or file contents are collected."
		>
			<Switch
				checked={analyticsPrefs.enabled}
				onCheckedChange={(checked) => {
					void analyticsPrefs.setEnabled(checked === true);
				}}
			/>
		</SettingRow>
	</SettingsSection>

	<!-- Danger Zone — standalone emphasized card (per R18) -->
	<div class="mt-16">
		<SettingsSectionHeader
			title={m.settings_danger_zone()}
			description="Reset local app data and start fresh."
		/>
		<div class="overflow-hidden rounded-lg bg-destructive/5 shadow-sm">
			<div class="flex items-center justify-between gap-4 px-4 py-3">
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
					class="shrink-0 rounded-md bg-destructive px-2.5 py-1 text-[12px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
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
