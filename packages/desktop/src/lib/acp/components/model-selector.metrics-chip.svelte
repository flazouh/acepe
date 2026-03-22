<script lang="ts">
import { getSessionStore } from "$lib/acp/store/index.js";
import { AGENT_IDS } from "$lib/acp/types/agent-id.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import {
	formatTokenCountCompact,
	formatTokenUsageCompact,
} from "./model-selector.metrics-chip.logic.js";

interface Props {
	sessionId: string | null;
	agentId?: string | null;
}

let { sessionId, agentId = null }: Props = $props();

const sessionStore = getSessionStore();

const usageTelemetry = $derived.by(() => {
	if (!sessionId) return null;
	return sessionStore.getHotState(sessionId).usageTelemetry ?? null;
});

const contextWindow = $derived(usageTelemetry?.contextWindowSize ?? null);
const isClaudeCode = $derived(agentId === AGENT_IDS.CLAUDE_CODE);

const showChip = $derived(usageTelemetry != null);
const showSpend = $derived(usageTelemetry != null && usageTelemetry.sessionSpendUsd > 0);
const spendText = $derived(
	usageTelemetry != null ? `$${usageTelemetry.sessionSpendUsd.toFixed(2)}` : ""
);
const total = $derived(usageTelemetry?.latestTokensTotal ?? null);
const hasRing = $derived(contextWindow != null && contextWindow > 0 && total != null && total >= 0);
const percent = $derived(
	hasRing && contextWindow != null && contextWindow > 0 && total != null
		? Math.min(100, (total / contextWindow) * 100)
		: 0
);
const remaining = $derived(
	hasRing && contextWindow != null && total != null ? Math.max(0, contextWindow - total) : null
);
const tokenUsageText = $derived(formatTokenUsageCompact(total, contextWindow));
const claudeUsageText = $derived.by(() => {
	if (tokenUsageText) return tokenUsageText;
	if (total != null && total >= 0) return formatTokenCountCompact(total);
	return "0";
});
const statusLabel = $derived(
	isClaudeCode ? "Context window usage" : "Session spend and context usage"
);

const tooltipLines = $derived.by(() => {
	if (!usageTelemetry) return [];
	const lines: string[] = [];
	lines.push(`Session spend: $${usageTelemetry.sessionSpendUsd.toFixed(4)}`);
	if (usageTelemetry.latestStepCostUsd != null) {
		lines.push(`Latest step: $${usageTelemetry.latestStepCostUsd.toFixed(4)}`);
	}
	if (hasRing && contextWindow != null && total != null) {
		lines.push(`Used: ${total.toLocaleString()} / ${contextWindow.toLocaleString()}`);
		if (remaining != null) {
			lines.push(`Remaining: ${remaining.toLocaleString()}`);
		}
		lines.push(`${percent.toFixed(1)}% used`);
	} else if (total != null) {
		lines.push(`Tokens (latest): ${total.toLocaleString()}`);
	}
	return lines;
});
</script>

{#if showChip}
	<Tooltip.Root>
		<Tooltip.Trigger>
			<div
				class="flex h-7 items-center gap-1 px-1.5 text-[11px] text-muted-foreground"
				role="status"
				aria-label={statusLabel}
			>
				{#if isClaudeCode}
					<span class="font-mono font-medium tabular-nums">{claudeUsageText}</span>
				{:else if showSpend}
					<span class="font-mono font-medium tabular-nums">{spendText}</span>
				{/if}
				{#if hasRing}
					<svg class="size-3.5 shrink-0 -rotate-90" viewBox="0 0 14 14" aria-hidden="true">
						<circle
							cx="7"
							cy="7"
							r="5.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.2"
							opacity="0.25"
						/>
						<circle
							cx="7"
							cy="7"
							r="5.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.2"
							stroke-dasharray={2 * Math.PI * 5.5}
							stroke-dashoffset={2 * Math.PI * 5.5 * (1 - percent / 100)}
							stroke-linecap="round"
						/>
					</svg>
				{/if}
			</div>
		</Tooltip.Trigger>
		<Tooltip.Content>
			<div class="flex flex-col gap-0.5 text-xs">
				{#each tooltipLines as line, i (i)}
					<span>{line}</span>
				{/each}
			</div>
		</Tooltip.Content>
	</Tooltip.Root>
{/if}
