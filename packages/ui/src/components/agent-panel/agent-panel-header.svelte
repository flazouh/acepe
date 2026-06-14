<script lang="ts">
	import type { Snippet } from "svelte";

	import { Button } from "../button/index.js";
	import {
		CloseAction,
		EmbeddedPanelHeader,
		FullscreenAction,
		HeaderActionCell,
		HeaderCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { RichTokenText } from "../rich-token-text/index.js";
	import * as Tooltip from "../tooltip/index.js";
	import {
		getAgentPanelHeaderTitle,
		getHeaderStatusIndicatorKind,
		getVisibleHeaderActionButtons,
		hasAgentPanelHeaderMetaChips,
		isHeaderActionDisabled,
		shouldShowAgentPanelHeaderTitleTooltip,
	} from "./agent-panel-header-state.js";
	import type {
		AgentPanelActionCallbacks,
		AgentPanelActionDescriptor,
		AgentPanelBadge,
		AgentSessionStatus,
	} from "./types.js";

	interface Props {
		sessionTitle?: string;
		displayTitle?: string;
		/** Token-preserved title for rich tooltip rendering. */
		titleRichText?: string | null;
		agentIconSrc?: string;
		sessionStatus?: AgentSessionStatus;
		isFullscreen?: boolean;
		isConnecting?: boolean;
		pendingProjectSelection?: boolean;
		projectName?: string;
		projectColor?: string;
		projectIconSrc?: string | null;
		sequenceId?: number | null;
		onClose?: () => void;
		onToggleFullscreen?: () => void;
		onScrollToTop?: () => void;
		statusIndicator?: Snippet;
		leadingControl?: Snippet;
		dropdownMenu?: Snippet;
		trailingActions?: Snippet;
		/** Renders in the action cell before the dropdown menu — use for status icons. */
		statusAction?: Snippet;
		controls?: Snippet;
		/**
		 * Optional tooltip footer slot. When provided, it renders below the title inside
		 * the bottom tooltip. When absent, a default footer showing
		 * subtitle/agentLabel/branchLabel/badges is used if any are set.
		 */
		expansion?: Snippet;
		subtitle?: string;
		agentLabel?: string | null;
		branchLabel?: string | null;
		badges?: readonly AgentPanelBadge[];
		actionButtons?: readonly AgentPanelActionDescriptor[];
		actionCallbacks?: AgentPanelActionCallbacks;
		showTrailingBorder?: boolean;
		class?: string;
	}

	let {
		sessionTitle,
		displayTitle,
		titleRichText = null,
		agentIconSrc,
		sessionStatus = "empty",
		isFullscreen = false,
		isConnecting = false,
		pendingProjectSelection = false,
		projectName,
		projectColor,
		projectIconSrc,
		sequenceId,
		onClose,
		onToggleFullscreen,
		onScrollToTop,
		statusIndicator,
		leadingControl,
		dropdownMenu,
		trailingActions,
		statusAction,
		controls,
		expansion,
		subtitle,
		agentLabel,
		branchLabel,
		badges = [],
		actionButtons = [],
		actionCallbacks = {},
		showTrailingBorder = false,
		class: className = "",
	}: Props = $props();

	const visibleActionButtons = $derived(getVisibleHeaderActionButtons(actionButtons));
	const resolvedTitle = $derived(getAgentPanelHeaderTitle({ displayTitle, sessionTitle }));
	const hasMetaChips = $derived(
		hasAgentPanelHeaderMetaChips({ subtitle, agentLabel, branchLabel, badges })
	);
	const showTitleTooltip = $derived(
		shouldShowAgentPanelHeaderTitleTooltip({ pendingProjectSelection })
	);
	const statusIndicatorKind = $derived(
		getHeaderStatusIndicatorKind({
			hasCustomStatusIndicator: Boolean(statusIndicator),
			isConnecting,
			sessionStatus,
		})
	);

	function runAction(action: AgentPanelActionDescriptor): void {
		const callback = actionCallbacks[action.id];
		callback?.();
	}
</script>

<div class={className}>
	<EmbeddedPanelHeader
		onHeaderClick={onScrollToTop}
	>
		{#if pendingProjectSelection}
			{#if leadingControl}
				<HeaderCell withDivider={false}>
					{@render leadingControl()}
				</HeaderCell>
			{/if}
			<HeaderTitleCell>
				{#snippet children()}
					<span class="text-[11px] font-medium truncate">Select a project</span>
				{/snippet}
			</HeaderTitleCell>
			<HeaderActionCell>
				{#snippet children()}
					<CloseAction onClose={onClose} />
				{/snippet}
			</HeaderActionCell>
		{:else}
			{#if projectName && projectColor}
				<HeaderCell withDivider={false}>
					<ProjectLetterBadge
						name={projectName}
						color={projectColor}
						iconSrc={projectIconSrc}
						size={14}
						sequenceId={sequenceId}
						class="shrink-0"
					/>
				</HeaderCell>
			{/if}
			{#if leadingControl}
				<HeaderCell>
					{@render leadingControl()}
				</HeaderCell>
			{:else if agentIconSrc}
				<HeaderCell>
					<img src={agentIconSrc} alt="" class="w-3.5 h-3.5" role="presentation" />
				</HeaderCell>
			{/if}
			<HeaderTitleCell>
				{#snippet children()}
					<div class="flex items-center gap-1.5 min-w-0 flex-1">
						{#if statusIndicatorKind === "custom" && statusIndicator}
							{@render statusIndicator()}
						{:else if statusIndicatorKind === "connecting"}
							<span class="relative flex h-2 w-2 shrink-0">
								<span
									class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-muted-foreground"
								></span>
								<span class="relative inline-flex rounded-full h-2 w-2 bg-muted-foreground"></span>
							</span>
						{:else if statusIndicatorKind === "connected"}
							<span class="h-2 w-2 rounded-full shrink-0 bg-success"></span>
						{:else if statusIndicatorKind === "error"}
							<span class="h-2 w-2 rounded-full shrink-0 bg-destructive"></span>
						{/if}
						{#if showTitleTooltip}
							<Tooltip.Root>
								<Tooltip.Trigger class="min-w-0 truncate text-left">
									<span
										class="agent-panel-header-title block min-w-0 truncate text-[12px] font-medium text-foreground"
									>
										{resolvedTitle}
									</span>
								</Tooltip.Trigger>
								<Tooltip.Content
									side="bottom"
									sideOffset={6}
									class="max-w-sm px-2.5 py-2 text-xs"
								>
									{#if titleRichText}
										<RichTokenText
											text={titleRichText}
											class="text-foreground font-medium"
										/>
									{:else}
										<p class="m-0 font-medium text-foreground">{resolvedTitle}</p>
									{/if}
									{#if expansion}
										<div class="mt-1.5">
											{@render expansion()}
										</div>
									{:else if hasMetaChips}
										<div class="mt-1.5 flex flex-wrap items-center gap-1">
											{#if subtitle}
												<span
													class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
													>{subtitle}</span
												>
											{/if}
											{#if agentLabel}
												<span
													class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
													>{agentLabel}</span
												>
											{/if}
											{#if branchLabel}
												<span
													class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
													>{branchLabel}</span
												>
											{/if}
											{#each badges ?? [] as badge (badge.id)}
												<span
													class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
												>
													{badge.label}
												</span>
											{/each}
										</div>
									{/if}
								</Tooltip.Content>
							</Tooltip.Root>
						{:else}
							<span
								class="agent-panel-header-title min-w-0 truncate text-[12px] font-medium text-foreground"
							>
								{resolvedTitle}
							</span>
						{/if}
					</div>
				{/snippet}
			</HeaderTitleCell>

			<HeaderActionCell withDivider={false}>
				{#snippet children()}
					{#if controls}
						{@render controls()}
					{:else}
						{#if statusAction}
							{@render statusAction()}
						{/if}
						{#if dropdownMenu}
							{@render dropdownMenu()}
						{/if}
						{#if trailingActions}
							{@render trailingActions()}
						{/if}
						{#if visibleActionButtons.length > 0}
							<div class="flex items-center gap-1 px-1">
								{#each visibleActionButtons as action (action.id)}
									<Button
										variant={action.destructive ? "destructive" : "headerAction"}
										size="headerAction"
										disabled={isHeaderActionDisabled(action)}
										title={action.description ?? undefined}
										onclick={() => runAction(action)}
									>
										{action.label ?? action.id}
									</Button>
								{/each}
							</div>
						{/if}
						{#if onToggleFullscreen}
							<FullscreenAction isFullscreen={isFullscreen} onToggle={onToggleFullscreen} />
						{/if}
						<CloseAction onClose={onClose} />
					{/if}
				{/snippet}
			</HeaderActionCell>
		{/if}
	</EmbeddedPanelHeader>
</div>
