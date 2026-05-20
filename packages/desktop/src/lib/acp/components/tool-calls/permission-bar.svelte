<script lang="ts">
import {
	AgentPanelPermissionBar as SharedAgentPanelPermissionBar,
	AgentPanelPermissionBarIcon,
	AgentPanelPermissionBarProgress,
	AgentPanelPermissionBarActions,
} from "@acepe/ui/agent-panel";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { PermissionRequest } from "../../types/permission.js";
import { Colors, COLOR_NAMES } from "@acepe/ui/colors";
import { AgentToolEdit } from "@acepe/ui/agent-panel";
import { mapToolCallToSceneEntry } from "../agent-panel/scene/desktop-agent-panel-scene.js";
import { mapCanonicalTurnStateToPresentationStatus } from "../../store/canonical-turn-state-mapping.js";
import {
	extractCompactPermissionDisplay,
	shouldShowPermissionBarSummary,
} from "./permission-display.js";
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
const showEditPreview = $derived(
	showCompactEditPreview && currentToolCall !== null && currentToolCall.kind === "edit"
);

// ===== EDIT TOOL THEME =====
const themeState = useTheme();
const editTheme = $derived(themeState.effectiveTheme);
</script>


{#if currentPermission}
	{@const compactDisplay = extractCompactPermissionDisplay(currentPermission, projectPath, currentToolCall)}
	{@const kind = compactDisplay.kind}
	{@const command =
		showCommandWhenRepresented || !isRepresentedByToolCall ? compactDisplay.command : null}
	{@const filePath = compactDisplay.filePath}
	{@const verb = compactDisplay.label}
	{@const showSummary = shouldShowPermissionBarSummary({
		isRepresentedByToolCall,
		display: compactDisplay,
		toolCall: currentToolCall,
	})}
	<SharedAgentPanelPermissionBar
		{verb}
		{filePath}
		showFilePath={!showEditPreview}
		{showSummary}
		{command}
		{attachment}
		hasProgress={sessionProgress !== null && sessionProgress !== undefined}
		hasEditPreview={showEditPreview && currentToolCall !== null}
	>
		{#snippet leading()}
			<AgentPanelPermissionBarIcon {kind} color={Colors[COLOR_NAMES.PURPLE]} />
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
				showAlwaysAllow={currentPermission.always !== undefined && currentPermission.always.length > 0}
				onAllow={() => permissionStore.reply(currentPermission.id, "once")}
				onAlwaysAllow={() => permissionStore.reply(currentPermission.id, "always")}
				onDeny={() => permissionStore.reply(currentPermission.id, "reject")}
			/>
		{/snippet}

		{#snippet editPreview()}
			{#if showEditPreview && currentToolCall}
				{@const mappedTurnState = effectiveTurnState !== null ? mapCanonicalTurnStateToPresentationStatus(effectiveTurnState) : undefined}
				{@const sceneEntry = mapToolCallToSceneEntry(currentToolCall, mappedTurnState, false, null)}
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
