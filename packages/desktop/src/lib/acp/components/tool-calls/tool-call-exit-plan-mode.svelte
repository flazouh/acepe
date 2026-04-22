<script lang="ts">
/**
 * Tool Call Exit Plan Mode Component
 *
 * Renders ExitPlanMode (exit_plan_mode kind) tool calls.
 * In inline mode: shows PlanCard with plan preview and Build/Cancel actions.
 * In sidebar mode: shows embedded header bar; plan content in the sidebar panel.
 */
import { AgentToolCard } from "@acepe/ui/agent-panel";
import { BuildIcon, PlanIcon } from "@acepe/ui/icons";
import { EmbeddedPanelHeader, HeaderActionCell, HeaderTitleCell } from "@acepe/ui/panel-header";
import type { PlanCardStatus } from "@acepe/ui/plan-card";
import { PlanCard } from "@acepe/ui/plan-card";
import { XCircle } from "phosphor-svelte";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { usePlanInline } from "../../hooks/use-plan-inline.svelte.js";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { getPanelStore } from "../../store/panel-store.svelte.js";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { getPlanPreferenceStore } from "../../store/plan-preference-store.svelte.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { findExitPlanPermission, getExitPlanDisplayPlan } from "./exit-plan-helpers.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

let localOutcome = $state<"building" | "rejected" | null>(null);

const permissionStore = getPermissionStore();
const panelStore = getPanelStore();
const planPrefs = getPlanPreferenceStore();
const sessionContext = useSessionContext();

const inline = usePlanInline({
	getTurnState: () => turnState,
	getAwaitingPlanApproval: () => false,
});

const pendingPermission = $derived.by(() => {
	const sessionId = sessionContext?.sessionId;
	if (!sessionId) {
		return null;
	}

	return findExitPlanPermission(toolCall, permissionStore.getForSession(sessionId));
});

const displayPlan = $derived.by(() => {
	return getExitPlanDisplayPlan(toolCall, pendingPermission, inline.plan);
});

const displayContent = $derived.by(() => {
	if (displayPlan !== null) {
		return displayPlan.content;
	}

	return "";
});

const previewContent = $derived.by(() => {
	if (inline.debouncedContent.length > 0) {
		return inline.debouncedContent;
	}

	return displayContent;
});

const displayTitle = $derived.by(() => {
	if (displayPlan !== null) {
		return displayPlan.title;
	}

	return "Plan";
});

function handleBuildManual() {
	if (pendingPermission) {
		localOutcome = "building";
		permissionStore.reply(pendingPermission.id, "once");
	}
}

function handleCancelManual() {
	if (pendingPermission) {
		localOutcome = "rejected";
		permissionStore.reply(pendingPermission.id, "reject");
	}
}

// --- Sidebar auto-open: gated behind preference ---
let hasAutoOpened = $state(false);

$effect(() => {
	if (!planPrefs.isReady) return;
	if (planPrefs.preferInline) return;
	if (hasAutoOpened) return;
	hasAutoOpened = true;

	const focusedPanelId = panelStore.focusedPanelId;
	if (focusedPanelId && !panelStore.isPlanSidebarExpanded(focusedPanelId)) {
		panelStore.setPlanSidebarExpanded(focusedPanelId, true);
	}
});

// --- Keyboard shortcut: Cmd+Enter to build ---
$effect(() => {
	if (!pendingPermission) return;
	const currentPermissionId = pendingPermission.id;

	const handleKeyDown = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			const current = permissionStore.getForToolCall(
				sessionContext?.sessionId,
				toolCall,
			);
			if (current?.id === currentPermissionId) {
				handleBuildManual();
			}
		}
	};

	window.addEventListener("keydown", handleKeyDown);
	return () => window.removeEventListener("keydown", handleKeyDown);
});

// PlanCard status derivation
const cardStatus = $derived.by((): PlanCardStatus => {
	if (toolCall.status === "failed") return "rejected";
	if (localOutcome === "rejected") return "rejected";
	if (inline.isStreaming) return "streaming";
	if (localOutcome === "building") return "building";
	if (pendingPermission) return "interactive";
	return "approved";
});
</script>

{#if inline.useInline && (previewContent.length > 0 || inline.isStreaming || pendingPermission !== null)}
	<!-- Inline mode: PlanCard with preview -->
	<PlanCard
		content={previewContent}
		title={displayTitle}
		status={cardStatus}
		actionsDisabled={!inline.canAct}
		onViewFull={inline.handleViewFull}
		onBuild={pendingPermission ? handleBuildManual : undefined}
		onCancel={pendingPermission ? handleCancelManual : undefined}
	>
		{#snippet headerExtra()}
			{#if elapsedLabel}
				<HeaderActionCell>
					<span class="inline-flex items-center px-2 font-mono text-[10px] text-muted-foreground/70"
						>{elapsedLabel}</span
					>
				</HeaderActionCell>
			{/if}
		{/snippet}
	</PlanCard>

	{#if displayPlan}
		{#await import("../plan-dialog.svelte") then module}
			{@const PlanDialog = module.default}
			<PlanDialog
				plan={displayPlan}
				open={inline.showPlanDialog}
				onOpenChange={(open) => (inline.showPlanDialog = open)}
			/>
		{/await}
	{/if}
{:else}
	<!-- Sidebar mode: original compact card -->
	<AgentToolCard>
		<EmbeddedPanelHeader class="bg-accent/40">
			<HeaderTitleCell compactPadding>
				<PlanIcon size="sm" class="shrink-0 mr-1" />
				<span class="text-[11px] font-semibold font-mono text-foreground select-none leading-none">
					Plan
				</span>
			</HeaderTitleCell>
			{#if pendingPermission}
				<HeaderActionCell>
					<button
						type="button"
						class="plan-action-btn"
						onclick={handleCancelManual}
						disabled={localOutcome === "building"}
					>
						<XCircle weight="fill" class="size-3 shrink-0" />
						Cancel
					</button>
				</HeaderActionCell>
				<HeaderActionCell>
					<button
						type="button"
						class="plan-action-btn"
						onclick={handleBuildManual}
						disabled={localOutcome === "building"}
					>
					{#if localOutcome === "building"}
						<Spinner class="size-3 shrink-0" />
						{"Building"}
					{:else}
						<BuildIcon size="sm" />
						{"Build"}
					{/if}
					</button>
				</HeaderActionCell>
			{/if}
			{#if elapsedLabel}
				<HeaderActionCell>
					<span class="inline-flex items-center px-2 font-mono text-[10px] text-muted-foreground/70"
						>{elapsedLabel}</span
					>
				</HeaderActionCell>
			{/if}
		</EmbeddedPanelHeader>
	</AgentToolCard>
{/if}

<style>
	.plan-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 100%;
		font: inherit;
		font-size: 0.625rem;
		font-weight: 500;
		font-family: var(--font-mono, ui-monospace, monospace);
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.plan-action-btn:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--accent) 50%, transparent);
	}

	.plan-action-btn:disabled {
		opacity: 0.5;
		pointer-events: none;
	}
</style>
