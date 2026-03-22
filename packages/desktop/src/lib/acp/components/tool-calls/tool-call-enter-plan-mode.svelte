<script lang="ts">
/**
 * Tool Call Enter Plan Mode Component
 *
 * Renders EnterPlanMode (enter_plan_mode kind) tool calls.
 * Displays the plan file path and status.
 */

import { FilePathBadge, TextShimmer } from "@acepe/ui";
import { AgentToolCard } from "@acepe/ui/agent-panel";
import FolderOpen from "phosphor-svelte/lib/FolderOpen";
import Notepad from "phosphor-svelte/lib/Notepad";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import type { SessionPlanResponse } from "$lib/services/converted-session-types.js";
import { revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
import { getPanelStore } from "../../store/panel-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();

const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Load session plan based on focused panel's session
let sessionPlan = $state<SessionPlanResponse | null>(null);

// Get session details from focused panel
const sessionId = $derived(panelStore.focusedPanel?.sessionId ?? null);
const session = $derived(sessionId ? sessionStore.getSessionCold(sessionId) : null);

// Track last loaded session to prevent redundant fetches
let lastLoadedSessionId = "";

// Load plan when session ID changes
$effect(() => {
	const currentSession = session;
	if (!currentSession?.id || !currentSession?.projectPath || !currentSession?.agentId) {
		sessionPlan = null;
		lastLoadedSessionId = "";
		return;
	}

	// Guard: Only fetch if session ID actually changed
	if (currentSession.id === lastLoadedSessionId) {
		return;
	}
	lastLoadedSessionId = currentSession.id;

	// Load the plan for this session
	tauriClient.history
		.getUnifiedPlan(currentSession.id, currentSession.projectPath, currentSession.agentId)
		.match(
			(plan) => {
				sessionPlan = plan;
			},
			() => {
				sessionPlan = null;
			}
		);
});

// Plan file info
const planFilePath = $derived(sessionPlan?.filePath ?? null);
const fileName = $derived(
	sessionPlan?.slug ? `${sessionPlan.slug}.md` : (planFilePath?.split("/").pop() ?? null)
);

// Actions
function handleOpenPlanInFinder() {
	if (!planFilePath) {
		toast.error("Plan file path not available");
		return;
	}

	revealInFinder(planFilePath).match(
		() => {
			// Success - no toast needed
		},
		() => {
			toast.error("Failed to open plan in Finder");
		}
	);
}

function handleViewPlan() {
	if (panelStore.focusedPanelId) {
		panelStore.togglePlanSidebar(panelStore.focusedPanelId);
	}
}
</script>

<AgentToolCard>
	<div class="space-y-2 p-2.5">
		<!-- Header: Plan icon + status + file badge + actions -->
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-1.5 min-w-0 text-xs">
				<Notepad class="size-4 text-primary shrink-0" weight="fill" />
				<span class="font-medium shrink-0">
					{#if toolStatus.isPending}
						<TextShimmer class="inline-flex h-4 m-0 items-center text-xs leading-none">
							Entering plan mode
						</TextShimmer>
					{:else}
						Entered plan mode
					{/if}
				</span>
			</div>

			<!-- Right side actions -->
			<div class="flex items-center gap-2">
				{#if elapsedLabel}
					<span class="font-mono text-[10px] text-muted-foreground/70">{elapsedLabel}</span>
				{/if}
				{#if planFilePath}
					<Button
						variant="ghost"
						size="icon"
						class="size-6"
						onclick={handleOpenPlanInFinder}
						title="Open plan in Finder"
					>
						<FolderOpen class="size-3.5" weight="bold" />
						<span class="sr-only">Open plan in Finder</span>
					</Button>
				{/if}
			</div>
		</div>

		<!-- Plan file badge -->
		{#if fileName && planFilePath}
			<div class="flex items-center gap-1.5 text-xs">
				<FilePathBadge
					filePath={planFilePath}
					{fileName}
					iconBasePath="/svgs/icons"
					interactive={false}
				/>
			</div>
		{/if}

		<!-- View plan link -->
		{#if sessionPlan}
			<button
				type="button"
				class="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
				onclick={handleViewPlan}
			>
				<span>View plan</span>
			</button>
		{/if}
	</div>
</AgentToolCard>
