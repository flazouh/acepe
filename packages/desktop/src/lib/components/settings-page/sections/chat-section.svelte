<script lang="ts">
import { getChatPreferencesStore } from "$lib/acp/store/chat-preferences-store.svelte.js";
import { getPlanPreferenceStore } from "$lib/acp/store/plan-preference-store.svelte.js";
import { getReviewPreferenceStore } from "$lib/acp/store/review-preference-store.svelte.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/paraglide/messages.js";
import SettingsControlCard from "../settings-control-card.svelte";
import SettingsSection from "../settings-section.svelte";

const chatPrefs = getChatPreferencesStore();
const planPrefs = getPlanPreferenceStore();
const reviewPreferenceStore = getReviewPreferenceStore();
</script>

<div class="w-full">
	<SettingsSection
		title={m.settings_chat()}
		description="Pick the default behavior for chat and plan output."
	>
		<SettingsControlCard
			label={m.settings_chat_thinking_collapsed()}
			description={m.settings_chat_thinking_collapsed_description()}
		>
			{#if chatPrefs}
				<Switch
					checked={chatPrefs.thinkingBlockCollapsedByDefault}
					onCheckedChange={(checked) => {
						chatPrefs.setThinkingBlockCollapsedByDefault(checked === true);
					}}
				/>
			{/if}
		</SettingsControlCard>
		<SettingsControlCard
			label={m.settings_plans_prefer_inline()}
			description={m.settings_plans_prefer_inline_description()}
		>
			<Switch
				checked={planPrefs.preferInline}
				onCheckedChange={(checked) => {
					planPrefs.setPreferInline(checked === true);
				}}
			/>
		</SettingsControlCard>
	</SettingsSection>

	<SettingsSection
		title={m.modified_files_review_title()}
		description="Set how review opens when you inspect modified files."
	>
		<SettingsControlCard
			label={m.settings_review_prefer_fullscreen()}
			description={m.settings_review_prefer_fullscreen_description()}
		>
			<Switch
				checked={reviewPreferenceStore.preferFullscreen}
				onCheckedChange={(checked) => {
					reviewPreferenceStore.setPreferFullscreen(checked === true);
				}}
			/>
		</SettingsControlCard>
	</SettingsSection>
</div>
