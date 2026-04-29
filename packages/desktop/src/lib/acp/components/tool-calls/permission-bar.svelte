<script lang="ts">
import {
	AgentPanelPermissionBar as SharedAgentPanelPermissionBar,
	AgentPanelPermissionBarIcon,
	AgentPanelPermissionBarProgress,
	AgentPanelPermissionBarActions,
} from "@acepe/ui/agent-panel";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { SessionEntry } from "../../application/dto/session-entry.js";
import type { SessionTurnState } from "../../../services/acp-types.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { PermissionRequest } from "../../types/permission.js";
import { Colors, COLOR_NAMES } from "../../utils/colors.js";
import ToolCallEdit from "./tool-call-edit.svelte";
import { extractCompactPermissionDisplay } from "./permission-display.js";
import {
	isPermissionRepresentedByToolCall,
	visiblePermissionsForSessionBar,
} from "./permission-visibility.js";

interface Props {
	sessionId: string;
	permission?: PermissionRequest | null;
	isFullscreen?: boolean;
	projectPath?: string | null;
	showCommandWhenRepresented?: boolean;
	showCompactEditPreview?: boolean;
	entries?: readonly SessionEntry[];
	turnState?: SessionTurnState | null;
}

let {
	sessionId,
	permission = null,
	isFullscreen = false,
	projectPath = null,
	showCommandWhenRepresented = false,
	showCompactEditPreview = false,
	entries: _entriesProp = undefined,
	turnState: turnStateProp,
}: Props = $props();

const permissionStore = getPermissionStore();
const sessionStore = getSessionStore();
const operationStore = sessionStore.getOperationStore();

const pendingPermissions = $derived.by(() => {
	if (permission) {
		return [permission];
	}

	return visiblePermissionsForSessionBar(permissionStore.getForSession(sessionId), operationStore);
});
const currentPermission = $derived(pendingPermissions.length > 0 ? pendingPermissions[0] : null);
const isRepresentedByToolCall = $derived.by(() => {
	if (!currentPermission) {
		return false;
	}

	return isPermissionRepresentedByToolCall(currentPermission, sessionId, operationStore);
});
const sessionProgress = $derived(permissionStore.getSessionProgress(sessionId));
const effectiveTurnState = $derived(
	turnStateProp ?? sessionStore.getSessionTurnState(sessionId)
);
const currentToolCall = $derived.by((): ToolCall | null => {
	const toolCallId = currentPermission?.tool?.callID;
	if (!toolCallId) {
		return null;
	}

	return operationStore.getToolCallById(sessionId, toolCallId);
});
const showEditPreview = $derived(
	showCompactEditPreview && currentToolCall !== null && currentToolCall.kind === "edit"
);
</script>


{#if currentPermission}
	{@const compactDisplay = extractCompactPermissionDisplay(currentPermission, projectPath)}
	{@const kind = compactDisplay.kind}
	{@const command =
		showCommandWhenRepresented || !isRepresentedByToolCall ? compactDisplay.command : null}
	{@const filePath = compactDisplay.filePath}
	{@const verb = compactDisplay.label}
	<SharedAgentPanelPermissionBar
		{verb}
		{filePath}
		showFilePath={!showEditPreview}
		{command}
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
				showAlwaysAllow={currentPermission.always !== undefined && currentPermission.always.length > 0}
				onAllow={() => permissionStore.reply(currentPermission.id, "once")}
				onAlwaysAllow={() => permissionStore.reply(currentPermission.id, "always")}
				onDeny={() => permissionStore.reply(currentPermission.id, "reject")}
			/>
		{/snippet}

		{#snippet editPreview()}
			{#if showEditPreview && currentToolCall}
				<ToolCallEdit
					toolCall={currentToolCall}
					turnState={effectiveTurnState}
					projectPath={projectPath ?? undefined}
					pendingPermission={currentPermission}
					defaultExpanded={false}
				/>
			{/if}
		{/snippet}
	</SharedAgentPanelPermissionBar>
{/if}
