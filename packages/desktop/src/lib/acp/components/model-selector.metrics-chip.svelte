<script lang="ts">
import { AgentInputMetricsChip } from "@acepe/ui";
import { getSessionStore } from "$lib/acp/store/index.js";
import * as agentModelPrefs from "$lib/acp/store/agent-model-preferences-store.svelte.js";
import type { ModelsForDisplay } from "$lib/services/acp-provider-metadata.js";
import * as Tooltip from "@acepe/ui/tooltip";

import {
	formatTokenCountCompact,
	formatTokenUsageCompact,
	getContextUsagePercent,
	hasVisibleModelSelectorMetrics,
} from "./model-selector.metrics-chip.logic.js";
import {
	getUsageMetricsPresentation,
	isContextWindowOnlyMetrics,
} from "./model-selector-logic.js";

interface Props {
	sessionId?: string | null;
	agentId?: string | null;
	modelsDisplay?: ModelsForDisplay | null;
	compact?: boolean;
	hideLabel?: boolean;
}

let {
	sessionId = null,
	agentId = null,
	modelsDisplay: fallbackModelsDisplay = null,
	compact = false,
	hideLabel = true,
}: Props = $props();

const sessionStore = getSessionStore();

const cachedModelsDisplay = $derived(
	agentId ? agentModelPrefs.getCachedModelsDisplay(agentId) : null
);

const usageTelemetry = $derived.by(() => {
	if (!sessionId) return null;
	return sessionStore.read.getSessionUsageTelemetry(sessionId);
});

const modelsDisplay = $derived.by(() => {
	if (sessionId) {
		return (
			sessionStore.read.getSessionModelsDisplay(sessionId) ??
			fallbackModelsDisplay ??
			cachedModelsDisplay
		);
	}
	return fallbackModelsDisplay ?? cachedModelsDisplay;
});

const contextWindow = $derived(usageTelemetry?.contextBudget?.maxTokens ?? null);
const usageMetricsPresentation = $derived(getUsageMetricsPresentation(modelsDisplay));
const contextOnlyMetrics = $derived(isContextWindowOnlyMetrics(modelsDisplay));

const showChip = $derived(
	hasVisibleModelSelectorMetrics(
		usageTelemetry,
		contextOnlyMetrics,
		usageMetricsPresentation !== null
	)
);
const showSpend = $derived(usageTelemetry != null && usageTelemetry.sessionSpendUsd > 0);
const spendText = $derived(
	usageTelemetry != null ? `$${usageTelemetry.sessionSpendUsd.toFixed(2)}` : ""
);
const total = $derived(usageTelemetry?.latestTokensTotal ?? null);
const measuredPercent = $derived(getContextUsagePercent(total, contextWindow));
const hasMeasuredContextUsage = $derived(measuredPercent !== null);
const chipPercent = $derived(measuredPercent);
const hasContextMeter = $derived(chipPercent !== null);
const percentValue = $derived(chipPercent !== null ? chipPercent : 0);
const remaining = $derived(
	hasMeasuredContextUsage && contextWindow != null && total != null
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
	if (!usageTelemetry) {
		return usageMetricsPresentation !== null ? ["No context usage yet"] : [];
	}
	const lines: string[] = [];
	if (!contextOnlyMetrics) {
		lines.push(`Session spend: $${usageTelemetry.sessionSpendUsd.toFixed(4)}`);
	}
	if (usageTelemetry.latestStepCostUsd != null) {
		lines.push(`Latest step: $${usageTelemetry.latestStepCostUsd.toFixed(4)}`);
	}
	if (hasMeasuredContextUsage && contextWindow != null && total != null) {
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
		value={chipPercent === null
			? { kind: "unknown", label: "—" }
			: { kind: "measured", percent: chipPercent }}
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
					{#if hasContextMeter}
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
