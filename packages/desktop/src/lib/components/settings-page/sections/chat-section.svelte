<script lang="ts">
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import type { RevealMode } from "@acepe/ui/streaming-reveal";
import { getChatPreferencesStore } from "$lib/acp/store/chat-preferences-store.svelte.js";
import { getPlanPreferenceStore } from "$lib/acp/store/plan-preference-store.svelte.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";

const chatPrefs = getChatPreferencesStore();
const planPrefs = getPlanPreferenceStore();

const REVEAL_OPTIONS: { value: RevealMode; label: string }[] = [
	{ value: "instant", label: "Instant" },
	{ value: "buffer", label: "Buffer" },
	{ value: "buffer-fade", label: "Buffer + fade" },
	{ value: "block-fade", label: "Block fade" },
];

const selectedRevealLabel = $derived(
	REVEAL_OPTIONS.find((option) => option.value === (chatPrefs?.streamingRevealMode ?? "buffer"))
		?.label ?? "Buffer"
);

function handleRevealChange(value: string): void {
	chatPrefs?.setStreamingRevealMode(value as RevealMode);
}
</script>

<SettingsSection>
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
		<SettingRow
			label={"Streaming reveal"}
			description={"How assistant replies animate as they stream in."}
		>
			<Selector align="start" variant="outline" triggerSize="pill" class="w-[220px]">
				{#snippet renderButton()}
					<span>{selectedRevealLabel}</span>
				{/snippet}

				<DropdownMenu.RadioGroup
					value={chatPrefs.streamingRevealMode}
					onValueChange={handleRevealChange}
				>
					{#each REVEAL_OPTIONS as option (option.value)}
						<DropdownMenu.RadioItem value={option.value}>{option.label}</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</Selector>
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
