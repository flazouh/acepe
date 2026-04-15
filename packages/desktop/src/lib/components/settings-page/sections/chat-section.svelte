<script lang="ts">
import { getChatPreferencesStore } from "$lib/acp/store/chat-preferences-store.svelte.js";
import { getPlanPreferenceStore } from "$lib/acp/store/plan-preference-store.svelte.js";
import {
	STREAMING_ANIMATION_MODE_CLASSIC,
	STREAMING_ANIMATION_MODE_INSTANT,
	STREAMING_ANIMATION_MODE_SMOOTH,
	type StreamingAnimationMode,
} from "$lib/acp/types/streaming-animation-mode.js";
import * as Select from "$lib/components/ui/select/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import { CaretDown } from "phosphor-svelte";
import * as m from "$lib/messages.js";
import SettingsControlCard from "../settings-control-card.svelte";
import SettingsSection from "../settings-section.svelte";

const chatPrefs = getChatPreferencesStore();
const planPrefs = getPlanPreferenceStore();

const streamingAnimationOptions: ReadonlyArray<{
	value: StreamingAnimationMode;
	label: string;
	description: string;
}> = [
	{
		value: STREAMING_ANIMATION_MODE_SMOOTH,
		label: m.settings_chat_streaming_animation_smooth(),
		description: m.settings_chat_streaming_animation_smooth_description(),
	},
	{
		value: STREAMING_ANIMATION_MODE_CLASSIC,
		label: m.settings_chat_streaming_animation_classic(),
		description: m.settings_chat_streaming_animation_classic_description(),
	},
	{
		value: STREAMING_ANIMATION_MODE_INSTANT,
		label: m.settings_chat_streaming_animation_instant(),
		description: m.settings_chat_streaming_animation_instant_description(),
	},
];

const selectItems = streamingAnimationOptions.map((o) => ({
	value: o.value,
	label: o.label,
}));

const selectedLabel = $derived(
	streamingAnimationOptions.find(
		(o) => o.value === chatPrefs?.streamingAnimationMode
	)?.label ?? ""
);
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
		{#if chatPrefs}
			<div class="overflow-hidden rounded-sm border border-border bg-muted/30">
				<div class="flex items-center justify-between gap-3 px-3 py-2">
					<h3 class="min-w-0 text-[13px] font-medium text-foreground">
						{m.settings_chat_streaming_animation()}
					</h3>
					<Select.Root
						type="single"
						value={chatPrefs.streamingAnimationMode}
						onValueChange={(value) => {
							void chatPrefs.setStreamingAnimationMode(
								value as StreamingAnimationMode
							);
						}}
						items={selectItems}
					>
						<Select.Trigger
							size="sm"
							class="min-w-[11rem] text-[12px]"
							aria-label={m.settings_chat_streaming_animation()}
						>
							<span data-slot="select-value">{selectedLabel}</span>
							<CaretDown class="size-3 opacity-50" weight="bold" />
						</Select.Trigger>
						<Select.Content class="min-w-[14rem]">
							{#each streamingAnimationOptions as option (option.value)}
								<Select.Item
									value={option.value}
									label={option.label}
									class="py-2.5"
								>
									{#snippet children({ selected: _selected })}
										<div class="flex flex-col gap-1.5 min-w-0 pe-6">
											<span class="text-[13px] font-medium">{option.label}</span>
											<div
												class="preview-bar preview-{option.value}"
												aria-hidden="true"
											>
												<div class="bg-muted-foreground" style="width: 14px"></div>
												<div class="bg-muted-foreground" style="width: 22px"></div>
												<div class="bg-muted-foreground" style="width: 10px"></div>
												<div class="bg-muted-foreground" style="width: 18px"></div>
											</div>
										</div>
									{/snippet}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="border-t border-border/30 px-3 py-2">
					<p class="text-[12px] text-muted-foreground/60">
						{m.settings_chat_streaming_animation_description()}
					</p>
				</div>
			</div>
		{/if}
	</SettingsSection>
</div>

<style>
	.preview-bar {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 2px 0;
	}

	.preview-bar > :global(div) {
		height: 3px;
		border-radius: 9999px;
		opacity: 0;
	}

	/* Smooth: staggered fade-in with ease */
	.preview-smooth > :global(div) {
		animation: smooth-reveal 2.8s ease-in-out infinite;
	}
	.preview-smooth > :global(div:nth-child(1)) { animation-delay: 0ms; }
	.preview-smooth > :global(div:nth-child(2)) { animation-delay: 280ms; }
	.preview-smooth > :global(div:nth-child(3)) { animation-delay: 560ms; }
	.preview-smooth > :global(div:nth-child(4)) { animation-delay: 840ms; }

	@keyframes smooth-reveal {
		0%, 8% { opacity: 0; }
		22%, 58% { opacity: 0.35; }
		76%, 100% { opacity: 0; }
	}

	/* Classic: staggered instant pop */
	.preview-classic > :global(div) {
		animation: classic-reveal 2.8s step-end infinite;
	}
	.preview-classic > :global(div:nth-child(1)) { animation-delay: 0ms; }
	.preview-classic > :global(div:nth-child(2)) { animation-delay: 280ms; }
	.preview-classic > :global(div:nth-child(3)) { animation-delay: 560ms; }
	.preview-classic > :global(div:nth-child(4)) { animation-delay: 840ms; }

	@keyframes classic-reveal {
		0%, 12% { opacity: 0; }
		13%, 58% { opacity: 0.35; }
		59%, 100% { opacity: 0; }
	}

	/* Instant: all at once */
	.preview-instant > :global(div) {
		animation: instant-reveal 2.8s step-end infinite;
	}

	@keyframes instant-reveal {
		0%, 4% { opacity: 0; }
		5%, 58% { opacity: 0.35; }
		59%, 100% { opacity: 0; }
	}
</style>
