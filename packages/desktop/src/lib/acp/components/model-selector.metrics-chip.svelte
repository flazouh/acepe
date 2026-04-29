<script lang="ts">
import { AgentInputMetricsChip } from "@acepe/ui";
import { getSessionStore } from "$lib/acp/store/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import {
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

let { sessionId, agentId: _agentId = null, compact = false, hideLabel = true }: Props = $props();

const sessionStore = getSessionStore();

const usageTelemetry = $derived.by(() => {
	if (!sessionId) return null;
	return sessionStore.getHotState(sessionId).usageTelemetry ?? null;
});

const modelsDisplay = $derived.by(() => {
	if (!sessionId) return null;
	return sessionStore.getSessionCapabilities(sessionId).modelsDisplay ?? null;
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
const statusLabel = $derived(
	contextOnlyMetrics ? "Context window usage" : "Session spend and context usage"
);
const chipLabel = $derived.by(() => {
	if (hideLabel) {
		return null;
	}
	if (contextOnlyMetrics) {
		return claudeUsageText;
	}
	if (showSpend) {
		return spendText;
	}
	return null;
});

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
	<AgentInputMetricsChip
		{compact}
		{hideLabel}
		label={chipLabel}
		percent={hasContextUsage ? percent : null}
		ariaLabel={statusLabel}
	/>
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
