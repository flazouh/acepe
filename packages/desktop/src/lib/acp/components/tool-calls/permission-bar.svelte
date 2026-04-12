<script lang="ts">
import {
	AgentPanelPermissionBar as SharedAgentPanelPermissionBar,
	AgentPanelPermissionBarIcon,
	AgentPanelPermissionBarProgress,
	AgentPanelPermissionBarActions,
} from "@acepe/ui/agent-panel";
import * as m from "$lib/paraglide/messages.js";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { SessionEntry } from "../../application/dto/session-entry.js";
import type { TurnState } from "../../store/types.js";
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
	turnState?: TurnState;
}

let {
	sessionId,
	permission = null,
	isFullscreen = false,
	projectPath = null,
	showCommandWhenRepresented = false,
	showCompactEditPreview = false,
	entries: entriesProp,
	turnState: turnStateProp,
}: Props = $props();

const permissionStore = getPermissionStore();
const sessionStore = getSessionStore();

const effectiveEntries = $derived(entriesProp ?? sessionStore.getEntries(sessionId));

const pendingPermissions = $derived.by(() => {
	if (permission) {
		return [permission];
	}

	return visiblePermissionsForSessionBar(permissionStore.getForSession(sessionId), effectiveEntries);
});
const currentPermission = $derived(pendingPermissions.length > 0 ? pendingPermissions[0] : null);
const isRepresentedByToolCall = $derived.by(() => {
	if (!currentPermission) {
		return false;
	}

	return isPermissionRepresentedByToolCall(
		currentPermission,
		sessionId,
		sessionStore.getOperationStore(),
		effectiveEntries
	);
});
const sessionProgress = $derived(permissionStore.getSessionProgress(sessionId));
const effectiveTurnState = $derived(turnStateProp ?? sessionStore.getHotState(sessionId)?.turnState);
const currentToolCall = $derived.by((): ToolCall | null => {
	const toolCallId = currentPermission?.tool?.callID;
	if (!toolCallId) {
		return null;
	}

	for (let index = effectiveEntries.length - 1; index >= 0; index -= 1) {
		const entry = effectiveEntries[index];
		if (entry.type === "tool_call" && entry.message.id === toolCallId) {
			return entry.message;
		}
	}

	return null;
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
				allowLabel={m.permission_allow()}
				alwaysAllowLabel={m.permission_always_allow()}
				denyLabel={m.permission_deny()}
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
