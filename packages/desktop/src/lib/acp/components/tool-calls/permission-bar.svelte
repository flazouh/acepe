<script lang="ts">
import {
	AgentPanelPermissionBar as SharedAgentPanelPermissionBar,
	AgentPanelPermissionBarIcon,
	AgentPanelPermissionBarProgress,
	AgentPanelPermissionBarActions,
} from "@acepe/ui/agent-panel";
import { Button } from "@acepe/ui/button";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { Robot } from "phosphor-svelte";
import * as m from "$lib/paraglide/messages.js";
import { toast } from "svelte-sonner";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import { createLogger } from "../../utils/logger.js";
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
const logger = createLogger({
	id: "permission-bar",
	name: "PermissionBar",
});

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
const autonomousAlreadyEnabled = $derived(
	sessionStore.getHotState(sessionId)?.autonomousEnabled ?? false
);
let autoButtonHighlighted = $state(false);

async function handleAutonomous(): Promise<void> {
	const result = await sessionStore.setAutonomousEnabled(sessionId, true);
	if (result.isErr()) {
		toast.error("Failed to enable Autonomous.");
		return;
	}
	const drainResult = await permissionStore.drainPendingForSession(sessionId);
	if (drainResult.isErr()) {
		logger.error("Failed to drain Autonomous permissions", { error: drainResult.error });
		toast.error("Autonomous is on, but some pending permissions still need attention.");
	}
}
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
		hasProgress={sessionProgress !== null && sessionProgress !== undefined && sessionProgress.total > 1}
		hasEditPreview={showEditPreview && currentToolCall !== null}
	>
		{#snippet leading()}
			<AgentPanelPermissionBarIcon {kind} color="var(--token-plan-icon-dark)" />
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
			<div class="flex items-center justify-end gap-1">
				{#if !autonomousAlreadyEnabled}
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								variant="toolbar"
								size="toolbar"
								class="justify-center shrink-0"
								onclick={handleAutonomous}
								onmouseenter={() => {
									autoButtonHighlighted = true;
								}}
								onmouseleave={() => {
									autoButtonHighlighted = false;
								}}
								onfocus={() => {
									autoButtonHighlighted = true;
								}}
								onblur={() => {
									autoButtonHighlighted = false;
								}}
								aria-label={m.permission_autonomous()}
							>
								<Robot
									weight={autoButtonHighlighted ? "fill" : "regular"}
									class="size-3 shrink-0"
									style="color: {autoButtonHighlighted ? Colors[COLOR_NAMES.PURPLE] : 'currentColor'}"
								/>
								<span>Auto</span>
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{m.permission_autonomous()}</Tooltip.Content>
					</Tooltip.Root>
				{/if}
				<AgentPanelPermissionBarActions
					allowLabel={m.permission_allow()}
					alwaysAllowLabel={m.permission_always_allow()}
					denyLabel={m.permission_deny()}
					showAlwaysAllow={currentPermission.always !== undefined && currentPermission.always.length > 0}
					onAllow={() => permissionStore.reply(currentPermission.id, "once")}
					onAlwaysAllow={() => permissionStore.reply(currentPermission.id, "always")}
					onDeny={() => permissionStore.reply(currentPermission.id, "reject")}
				/>
			</div>
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
