<script lang="ts">
import { toast } from "svelte-sonner";
import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
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
		(error) => {
			toast.error(`Failed to reset database: ${error.message}`);
		}
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

	<!-- Danger Zone -->
	<div class="mt-5">
		<SettingsSectionHeader
			variant="subsection"
			title={"Danger Zone"}
			description="Reset local app data and start fresh."
		/>
		<SettingRow
			label={"Reset Database"}
			description="Deletes the local SQLite database (projects, API keys, preferences, session history). Session files on disk are not affected."
		>
			<button
				type="button"
				class="shrink-0 rounded-md bg-destructive px-2.5 py-1 text-[12px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
				onclick={() => (showResetConfirm = true)}
			>
				{"Reset Database"}
			</button>
		</SettingRow>
	</div>
</div>

<!-- Reset Database Confirmation Dialog -->
<AlertDialog.Root bind:open={showResetConfirm}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{"Reset Database?"}</AlertDialog.Title>
			<AlertDialog.Description>
				{"This will permanently delete the local SQLite database containing all your projects, API keys, preferences, and session history. Your session files on disk will not be affected. This action cannot be undone."}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{"Cancel"}</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				onclick={handleResetDatabase}
			>
				{"Reset Database"}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
