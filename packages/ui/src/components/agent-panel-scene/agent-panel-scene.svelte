<script lang="ts">
	import type { AgentPanelActionCallbacks, AgentPanelSceneModel } from "@acepe/agent-panel-contract";

	import AgentPanelSceneComposer from "./agent-panel-scene-composer.svelte";
	import AgentPanelSceneConversation from "./agent-panel-scene-conversation.svelte";
	import AgentPanelSceneHeader from "./agent-panel-scene-header.svelte";
	import AgentPanelSceneReviewCard from "./agent-panel-scene-review-card.svelte";
	import AgentPanelSceneSidebar from "./agent-panel-scene-sidebar.svelte";
	import AgentPanelSceneStatusStrip from "./agent-panel-scene-status-strip.svelte";

	interface Props {
		scene: AgentPanelSceneModel;
		actionCallbacks?: AgentPanelActionCallbacks;
		onComposerDraftTextChange?: (value: string) => void;
		iconBasePath?: string;
		isFullscreen?: boolean;
	}

	let {
		scene,
		actionCallbacks = {},
		onComposerDraftTextChange,
		iconBasePath = "",
		isFullscreen = false,
	}: Props = $props();

	const strips = $derived(scene.strips ?? []);
	const cards = $derived(scene.cards ?? []);
	const sidebars = $derived(scene.sidebars ?? null);
</script>

<div class="flex h-full min-h-0 overflow-hidden rounded-xl border border-border/50 bg-accent/20">
	<div class="flex min-w-0 flex-1 flex-col">
		<AgentPanelSceneHeader header={scene.header} {actionCallbacks} {isFullscreen} />

		{#if cards.length > 0 || strips.length > 0}
			<div class="shrink-0 space-y-2 border-b border-border/50 px-3 py-3">
				{#each strips as strip (strip.id)}
					<AgentPanelSceneStatusStrip {strip} {actionCallbacks} />
				{/each}
				{#each cards as card (card.id)}
					<AgentPanelSceneReviewCard {card} {actionCallbacks} />
				{/each}
			</div>
		{/if}

		<AgentPanelSceneConversation conversation={scene.conversation} {iconBasePath} />

		{#if scene.composer}
			<AgentPanelSceneComposer
				composer={scene.composer}
				{actionCallbacks}
				onDraftTextChange={onComposerDraftTextChange}
			/>
		{/if}
	</div>

	{#if sidebars}
		<AgentPanelSceneSidebar sidebars={sidebars} {actionCallbacks} />
	{/if}
</div>
