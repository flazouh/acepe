<script lang="ts">
import {
	AgentPanelPermissionBar as SharedAgentPanelPermissionBar,
	AgentPanelPermissionBarIcon,
	AgentPanelPermissionBarProgress,
	AgentPanelPermissionBarActions,
} from "@acepe/ui/agent-panel";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import { Colors, COLOR_NAMES } from "@acepe/ui/colors";
import { AgentToolEdit } from "@acepe/ui/agent-panel";
import { mapToolCallToSceneEntry } from "../agent-panel/scene/desktop-agent-panel-scene.js";
import { mapCanonicalTurnStateToPresentationStatus } from "../../store/canonical-turn-state-mapping.js";
import { buildPermissionBarDisplayModel } from "./permission-display.js";
import { useTheme } from "../../../components/theme/context.svelte.js";
import { getWorkerPool } from "../../utils/worker-pool-singleton.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../utils/pierre-diffs-theme.js";

interface Props {
	sessionId: string;
	permission?: PermissionRequest | null;
	isFullscreen?: boolean;
	projectPath?: string | null;
	showCommandWhenRepresented?: boolean;
	showCompactEditPreview?: boolean;
	hideRepresentedPermissions?: boolean;
	attachment?: "standalone" | "tool-call";
}

let {
	sessionId,
	permission = null,
	isFullscreen = false,
	projectPath = null,
	showCommandWhenRepresented = false,
	showCompactEditPreview = false,
	hideRepresentedPermissions = false,
	attachment = "standalone",
}: Props = $props();

const permissionStore = getPermissionStore();
const sessionStore = getSessionStore();

const pendingPermissions = $derived.by(() => {
	if (permission) {
		return [permission];
	}

	const visiblePermissions = sessionStore.getVisiblePermissionsForSessionBar(
		permissionStore.getForSession(sessionId)
	);
	if (!hideRepresentedPermissions) {
		return visiblePermissions;
	}

	return visiblePermissions.filter(
		(visiblePermission) =>
			!sessionStore.isPermissionRepresentedByToolCall(visiblePermission, sessionId)
	);
});
const currentPermission = $derived(pendingPermissions.length > 0 ? pendingPermissions[0] : null);
const passedPermissionToolCallId = $derived(permission?.tool?.callID ?? null);
const selectedReply = $derived(
	currentPermission !== null
		? (permissionStore.getReplyInFlight(currentPermission.id) ??
			(passedPermissionToolCallId !== null
				? permissionStore.getAnsweredForToolCall(sessionId, passedPermissionToolCallId)?.reply ?? null
				: null))
		: null
);
const isRepresentedByToolCall = $derived.by(() => {
	if (!currentPermission) {
		return false;
	}

	return sessionStore.isPermissionRepresentedByToolCall(currentPermission, sessionId);
});
const sessionProgress = $derived(permissionStore.getSessionProgress(sessionId));
const effectiveTurnState = $derived(sessionStore.getSessionTurnState(sessionId));
const currentToolCall = $derived.by((): ToolCall | null => {
	const toolCallId = currentPermission?.tool?.callID;
	if (!toolCallId) {
		return null;
	}

	return sessionStore.getToolCallById(sessionId, toolCallId);
});
const answeredPermission = $derived.by(() => {
	if (currentPermission !== null) {
		return null;
	}

	const toolCallId = passedPermissionToolCallId;
	if (!toolCallId) {
		return null;
	}

	const answered = permissionStore.getAnsweredForToolCall(sessionId, toolCallId);
	if (answered === null) {
		return null;
	}

	sessionStore.isToolCallExecuting(sessionId, toolCallId);
	return answered;
});
const displayPermission = $derived(currentPermission ?? answeredPermission?.permission ?? null);
const effectiveSelectedReply = $derived(selectedReply ?? answeredPermission?.reply ?? null);
const canReply = $derived(
	currentPermission !== null && permissionStore.isPending(currentPermission.id)
);
const showEditPreview = $derived(
	showCompactEditPreview && currentToolCall !== null && currentToolCall.kind === "edit"
);

// ===== EDIT TOOL THEME =====
const themeState = useTheme();
const editTheme = $derived(themeState.effectiveTheme);
</script>


{#if displayPermission}
	{@const permissionDisplay = buildPermissionBarDisplayModel({
		permission: displayPermission,
		projectPath,
		toolCall: currentToolCall,
		isRepresentedByToolCall,
		showCommandWhenRepresented,
	})}
	<SharedAgentPanelPermissionBar
		verb={permissionDisplay.verb}
		filePath={permissionDisplay.filePath}
		showFilePath={!showEditPreview}
		showSummary={permissionDisplay.showSummary}
		command={permissionDisplay.command}
		{attachment}
		hasProgress={sessionProgress !== null && sessionProgress !== undefined}
		hasEditPreview={showEditPreview && currentToolCall !== null}
	>
		{#snippet leading()}
			<AgentPanelPermissionBarIcon kind={permissionDisplay.kind} color={Colors[COLOR_NAMES.PURPLE]} />
		{/snippet}

		{#snippet progress()}
			{#if sessionProgress}
				<AgentPanelPermissionBarProgress
					completed={sessionProgress.completed}
					total={sessionProgress.total}
				/>
			{/if}
		{/snippet}

		{#snippet actionBar()}
			<AgentPanelPermissionBarActions
				allowLabel={"Allow"}
				alwaysAllowLabel={"Always"}
				denyLabel={"Deny"}
				align={attachment === "tool-call" ? "start" : "end"}
				selectedReply={effectiveSelectedReply}
				showAlwaysAllow={displayPermission.always !== undefined && displayPermission.always.length > 0}
				onAllow={() => {
					if (canReply) permissionStore.reply(displayPermission.id, "once");
				}}
				onAlwaysAllow={() => {
					if (canReply) permissionStore.reply(displayPermission.id, "always");
				}}
				onDeny={() => {
					if (canReply) permissionStore.reply(displayPermission.id, "reject");
				}}
			/>
		{/snippet}

		{#snippet editPreview()}
			{#if showEditPreview && currentToolCall}
				{@const mappedTurnState = effectiveTurnState !== null ? mapCanonicalTurnStateToPresentationStatus(effectiveTurnState) : undefined}
				{@const sceneEntry = mapToolCallToSceneEntry(currentToolCall, mappedTurnState, false, undefined)}
				{#if sceneEntry.type === "tool_call" && sceneEntry.editDiffs !== undefined}
					<AgentToolEdit
						diffs={sceneEntry.editDiffs}
						filePath={sceneEntry.filePath}
						status={sceneEntry.status}
						awaitingApproval={true}
						defaultExpanded={false}
						iconBasePath="/svgs/icons"
						theme={editTheme}
						themeNames={{ dark: "Cursor Dark", light: "pierre-light" }}
						workerPool={getWorkerPool()}
						onBeforeRender={registerCursorThemeForPierreDiffs}
						unsafeCSS={pierreDiffsUnsafeCSS}
					/>
				{/if}
			{/if}
		{/snippet}
	</SharedAgentPanelPermissionBar>
{/if}
