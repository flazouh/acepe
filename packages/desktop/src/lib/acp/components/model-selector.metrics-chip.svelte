<script lang="ts">
import { getSessionStore } from "$lib/acp/store/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { Colors } from "@acepe/ui/colors";

import {
	createContextUsageSegments,
	formatTokenCountCompact,
	formatTokenUsageCompact,
	getContextUsagePercent,
	hasVisibleModelSelectorMetrics,
} from "./model-selector.metrics-chip.logic.js";
import { isContextWindowOnlyMetrics } from "./model-selector-logic.js";

interface Props {
	sessionId: string | null;
	agentId?: string | null;
	compact?: boolean;
	hideLabel?: boolean;
}

let { sessionId, agentId: _agentId = null, compact = false, hideLabel = false }: Props = $props();

const sessionStore = getSessionStore();

const usageTelemetry = $derived.by(() => {
	if (!sessionId) return null;
	return sessionStore.getHotState(sessionId).usageTelemetry ?? null;
});

const modelsDisplay = $derived.by(() => {
	if (!sessionId) return null;
	return sessionStore.getCapabilities(sessionId).modelsDisplay ?? null;
});

const contextWindow = $derived(usageTelemetry?.contextBudget?.maxTokens ?? null);
const contextOnlyMetrics = $derived(isContextWindowOnlyMetrics(modelsDisplay));

const showChip = $derived(hasVisibleModelSelectorMetrics(usageTelemetry, contextOnlyMetrics));
const showSpend = $derived(usageTelemetry != null && usageTelemetry.sessionSpendUsd > 0);
const spendText = $derived(
	usageTelemetry != null ? `$${usageTelemetry.sessionSpendUsd.toFixed(2)}` : ""
);
const total = $derived(usageTelemetry?.latestTokensTotal ?? null);
const percent = $derived(getContextUsagePercent(total, contextWindow));
const hasContextUsage = $derived(percent !== null);
const percentValue = $derived(percent !== null ? percent : 0);
const remaining = $derived(
	hasContextUsage && contextWindow != null && total != null
		? Math.max(0, contextWindow - total)
		: null
);
const tokenUsageText = $derived(formatTokenUsageCompact(total, contextWindow));
const claudeUsageText = $derived.by(() => {
	if (tokenUsageText) return tokenUsageText;
	if (total != null && total >= 0) return formatTokenCountCompact(total);
	return "0";
});
const usageSegments = $derived(createContextUsageSegments(percent, compact ? 8 : 10));
const statusLabel = $derived(
	contextOnlyMetrics ? "Context window usage" : "Session spend and context usage"
);

const tooltipLines = $derived.by(() => {
	if (!usageTelemetry) return [];
	const lines: string[] = [];
	if (!contextOnlyMetrics) {
		lines.push(`Session spend: $${usageTelemetry.sessionSpendUsd.toFixed(4)}`);
	}
	if (usageTelemetry.latestStepCostUsd != null) {
		lines.push(`Latest step: $${usageTelemetry.latestStepCostUsd.toFixed(4)}`);
	}
	if (hasContextUsage && contextWindow != null && total != null) {
		lines.push(`Used: ${total.toLocaleString()} / ${contextWindow.toLocaleString()}`);
		if (remaining != null) {
			lines.push(`Remaining: ${remaining.toLocaleString()}`);
		}
		lines.push(`${percentValue.toFixed(1)}% used`);
	} else if (total != null) {
		lines.push(`Tokens (latest): ${total.toLocaleString()}`);
	}
	return lines;
});
</script>

{#snippet chipContent()}
	<div
		class="flex items-center text-muted-foreground {compact
			? 'h-5 gap-1 px-0.5 text-[10px]'
			: 'h-7 gap-1.5 px-1.5 text-[11px]'}"
		role="status"
		aria-label={statusLabel}
	>
		{#if !hideLabel}
			{#if contextOnlyMetrics}
				<span class="font-mono font-medium tabular-nums">{claudeUsageText}</span>
			{:else if showSpend}
				<span class="font-mono font-medium tabular-nums">{spendText}</span>
			{/if}
		{/if}
		{#if hasContextUsage}
			<div class="context-tally flex items-center gap-[2px]" class:context-tally-compact={compact} aria-hidden="true">
				{#each usageSegments as isFilled, index (index)}
					<span
						class="context-tally-bar"
						class:context-tally-bar-compact={compact}
						class:is-filled={isFilled}
						style={isFilled ? `background-color: ${Colors.purple};` : undefined}
					></span>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#if showChip}
	{#if compact}
		{@render chipContent()}
	{:else}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{@render chipContent()}
			</Tooltip.Trigger>
			<Tooltip.Content>
				<div class="flex flex-col gap-0.5 text-xs">
					{#if hasContextUsage}
						<span class="font-medium text-foreground">Context window</span>
					{/if}
					{#each tooltipLines as line, i (i)}
						<span>{line}</span>
					{/each}
				</div>
			</Tooltip.Content>
		</Tooltip.Root>
	{/if}
{/if}

<style>
	.context-tally {
		min-width: fit-content;
	}

	.context-tally-compact {
		gap: 1px;
	}

	.context-tally-bar {
		width: 3px;
		height: 10px;
		border-radius: 1px;
		background-color: color-mix(in srgb, var(--border) 55%, transparent);
		transition: background-color 160ms ease-out, opacity 160ms ease-out, transform 160ms ease-out;
		opacity: 0.55;
	}

	.context-tally-bar-compact {
		width: 2px;
		height: 8px;
	}

	.context-tally-bar.is-filled {
		opacity: 1;
	}

	:global([data-state="open"]) .context-tally-bar.is-filled,
	.context-tally-bar.is-filled:hover {
		transform: translateY(-0.5px);
	}
</style>
