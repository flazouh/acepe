<script lang="ts">
/**
 * Tool Call Exit Plan Mode Component
 *
 * Renders ExitPlanMode (exit_plan_mode kind) tool calls.
 * In inline mode: shows PlanCard with plan preview and Build/Review/Deepen actions.
 * In sidebar mode: shows embedded header bar; plan content in the sidebar panel.
 */
import {
	BuildIcon,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
	PlanIcon,
} from "@acepe/ui";
import { AgentToolCard } from "@acepe/ui/agent-panel";
import type { PlanCardStatus } from "@acepe/ui/plan-card";
import { PlanCard } from "@acepe/ui/plan-card";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/paraglide/messages.js";
import { usePlanInline } from "../../hooks/use-plan-inline.svelte.js";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { getPanelStore } from "../../store/panel-store.svelte.js";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { getPlanPreferenceStore } from "../../store/plan-preference-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import PlanDialog from "../plan-dialog.svelte";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

let isBuilding = $state(false);

const permissionStore = getPermissionStore();
const panelStore = getPanelStore();
const planPrefs = getPlanPreferenceStore();
const sessionStore = getSessionStore();
const sessionContext = useSessionContext();

const inline = usePlanInline({
	getTurnState: () => turnState,
	getAgentId: () => {
		const sid = sessionContext?.sessionId;
		if (!sid) return undefined;
		return sessionStore.getSessionCold(sid)?.agentId;
	},
	// exit_plan_mode doesn't use create_plan approval flow
	getPlanApprovalRequestId: () => undefined,
	getAwaitingPlanApproval: () => false,
});

const pendingPermission = $derived(
	permissionStore.getForToolCall(sessionContext?.sessionId, toolCall.id)
);

function handleBuildManual() {
	if (pendingPermission) {
		isBuilding = true;
		permissionStore.reply(pendingPermission.id, "once");
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
			const current = permissionStore.getForToolCall(sessionContext?.sessionId, toolCall.id);
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
	if (inline.isStreaming) return "streaming";
	if (isBuilding) return "building";
	if (pendingPermission) return "interactive";
	return "approved"; // permission resolved = approved (exit_plan_mode has no reject)
});
</script>

{#if inline.useInline}
	<!-- Inline mode: PlanCard with preview -->
	<PlanCard
		content={inline.debouncedContent}
		title={inline.plan?.title || "Plan"}
		status={cardStatus}
		actionsDisabled={!inline.canAct}
		skillsMissing={inline.planSkills.loaded && (!inline.planSkills.hasReview || !inline.planSkills.hasDeepen)}
		onViewFull={inline.handleViewFull}
		onBuild={pendingPermission ? handleBuildManual : undefined}
		onReview={inline.handleReview}
		onDeepen={inline.handleDeepen}
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

	{#if inline.plan}
		<PlanDialog
			plan={inline.plan}
			open={inline.showPlanDialog}
			onOpenChange={(open) => (inline.showPlanDialog = open)}
		/>
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
						onclick={handleBuildManual}
						disabled={isBuilding}
					>
					{#if isBuilding}
						<Spinner class="size-3 shrink-0" />
						{m.plan_sidebar_building()}
					{:else}
						<BuildIcon size="sm" />
						{m.plan_sidebar_build()}
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
