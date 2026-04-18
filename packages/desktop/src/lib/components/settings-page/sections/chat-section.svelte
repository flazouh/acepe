<script lang="ts">
import { getChatPreferencesStore } from "$lib/acp/store/chat-preferences-store.svelte.js";
import { getPlanPreferenceStore } from "$lib/acp/store/plan-preference-store.svelte.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/messages.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";

const chatPrefs = getChatPreferencesStore();
const planPrefs = getPlanPreferenceStore();
</script>

<SettingsSection
	title={m.settings_chat()}
	description="Pick the default behavior for chat and plan output."
>
	{#if chatPrefs}
		<SettingRow
			label={m.settings_chat_thinking_collapsed()}
			description={m.settings_chat_thinking_collapsed_description()}
		>
			<Switch
				checked={chatPrefs.thinkingBlockCollapsedByDefault}
				onCheckedChange={(checked) => {
					chatPrefs.setThinkingBlockCollapsedByDefault(checked === true);
				}}
			/>
		</SettingRow>
	{/if}
	<SettingRow
		label={m.settings_plans_prefer_inline()}
		description={m.settings_plans_prefer_inline_description()}
	>
		<Switch
			checked={planPrefs.preferInline}
			onCheckedChange={(checked) => {
				planPrefs.setPreferInline(checked === true);
			}}
		/>
	</SettingRow>
</SettingsSection>
