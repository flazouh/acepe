<script lang="ts">
import { getChatPreferencesStore } from "$lib/acp/store/chat-preferences-store.svelte.js";
import { getPlanPreferenceStore } from "$lib/acp/store/plan-preference-store.svelte.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";

const chatPrefs = getChatPreferencesStore();
const planPrefs = getPlanPreferenceStore();
</script>

<SettingsSection
	title={"Chat"}
	description="Pick the default behavior for chat and plan output."
>
	{#if chatPrefs}
		<SettingRow
			label={"Thinking block collapsed by default"}
			description={"Start with the thinking block collapsed; use the chevron to expand."}
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
		label={"Inline plan display"}
		description={"Show plans inline in chat instead of opening the sidebar"}
	>
		<Switch
			checked={planPrefs.preferInline}
			onCheckedChange={(checked) => {
				planPrefs.setPreferInline(checked === true);
			}}
		/>
	</SettingRow>
</SettingsSection>
