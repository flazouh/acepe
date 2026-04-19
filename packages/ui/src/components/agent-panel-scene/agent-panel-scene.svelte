<script lang="ts">
	import type { Snippet } from "svelte";
	import type { AgentPanelActionCallbacks, AgentPanelSceneModel } from "../agent-panel/types.js";

	import AgentPanelShell from "../agent-panel/agent-panel-shell.svelte";
import AgentPanelComposer from "../agent-panel/agent-panel-composer.svelte";
import AgentPanelComposerFrame from "../agent-panel/agent-panel-composer-frame.svelte";
import AgentPanelFooter from "../agent-panel/agent-panel-footer.svelte";
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
		widthStyle?: string;
		centerColumnStyle?: string;
		headerControls?: Snippet;
		topBarOverride?: Snippet;
		conversationBody?: Snippet;
		preComposerOverride?: Snippet;
		composerOverride?: Snippet;
		footerOverride?: Snippet;
		bottomDrawer?: Snippet;
		leadingPane?: Snippet;
		trailingPaneOverride?: Snippet;
	}

	let {
		scene,
		actionCallbacks = {},
		onComposerDraftTextChange,
		iconBasePath = "",
		widthStyle = "",
		centerColumnStyle = "",
		headerControls,
		topBarOverride,
		conversationBody,
		preComposerOverride,
		composerOverride,
		footerOverride,
		bottomDrawer,
		leadingPane,
		trailingPaneOverride,
	}: Props = $props();

	const isFullscreen = $derived(scene.chrome?.isFullscreen ?? false);
	const strips = $derived(scene.strips ?? []);
	const cards = $derived(scene.cards ?? []);
	const sidebars = $derived(scene.sidebars ?? null);
	const footerModel = $derived(scene.footer ?? null);
	const planStrips = $derived(strips.filter((s) => s.kind === "plan_header"));
	const nonPlanStrips = $derived(strips.filter((s) => s.kind !== "plan_header"));
	const hasPreComposerContent = $derived(nonPlanStrips.length > 0 || cards.length > 0);
</script>

<AgentPanelShell {widthStyle} {centerColumnStyle} isFullscreen={isFullscreen}>
	{#snippet header()}
		<AgentPanelSceneHeader header={scene.header} {actionCallbacks} {isFullscreen} controls={headerControls} />
	{/snippet}

	{#if leadingPane}
		{#snippet leadingPane()}
			{@render leadingPane()}
		{/snippet}
	{/if}

	{#snippet topBar()}
		{#if topBarOverride}
			{@render topBarOverride()}
		{:else if planStrips.length > 0}
			{#each planStrips as strip (strip.id)}
				<AgentPanelSceneStatusStrip {strip} {actionCallbacks} />
			{/each}
		{/if}
	{/snippet}

	{#snippet body()}
		{#if conversationBody}
			{@render conversationBody()}
		{:else}
			<AgentPanelSceneConversation conversation={scene.conversation} {iconBasePath} />
		{/if}
	{/snippet}

	{#snippet preComposer()}
		{#if preComposerOverride}
			{@render preComposerOverride()}
		{:else if hasPreComposerContent}
			<div class="shrink-0 space-y-2 px-3 py-2">
				{#each nonPlanStrips as strip (strip.id)}
					<AgentPanelSceneStatusStrip {strip} {actionCallbacks} />
				{/each}
				{#each cards as card (card.id)}
					<AgentPanelSceneReviewCard {card} {actionCallbacks} />
				{/each}
			</div>
		{/if}
	{/snippet}

	{#snippet composer()}
		{#if composerOverride}
			{@render composerOverride()}
		{:else if scene.composer}
			<AgentPanelComposerFrame>
				<AgentPanelComposer
					composer={scene.composer}
					{actionCallbacks}
					onDraftTextChange={onComposerDraftTextChange}
				/>
			</AgentPanelComposerFrame>
		{/if}
	{/snippet}

	{#snippet footer()}
		{#if footerOverride}
			{@render footerOverride()}
		{:else if footerModel}
			<AgentPanelFooter
				browserActive={footerModel.browserActive}
				showBrowserToggle={footerModel.showBrowserToggle}
				terminalActive={footerModel.terminalActive}
				terminalDisabled={footerModel.terminalDisabled}
				showTerminalToggle={footerModel.showTerminalToggle}
				onToggleBrowser={actionCallbacks["browser.openSidebar"]}
				onToggleTerminal={undefined}
			>
				{#snippet left()}
					{#if footerModel.branchLabel}
						<div class="px-2 text-[10px] font-mono text-muted-foreground">{footerModel.branchLabel}</div>
					{/if}
				{/snippet}
			</AgentPanelFooter>
		{/if}
	{/snippet}

	{#if bottomDrawer}
		{#snippet bottomDrawer()}
			{@render bottomDrawer()}
		{/snippet}
	{/if}

	{#if trailingPaneOverride || sidebars}
		{#snippet trailingPane()}
			{#if trailingPaneOverride}
				{@render trailingPaneOverride()}
			{:else if sidebars}
				<AgentPanelSceneSidebar {sidebars} {actionCallbacks} />
			{/if}
		{/snippet}
	{/if}
</AgentPanelShell>
