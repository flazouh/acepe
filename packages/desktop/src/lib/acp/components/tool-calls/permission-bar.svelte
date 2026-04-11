<script lang="ts">
import { AgentPanelPermissionBar as SharedAgentPanelPermissionBar } from "@acepe/ui/agent-panel";
import {
	ArrowsLeftRight,
	File,
	GlobeHemisphereWest,
	MagnifyingGlass,
	PencilSimple,
	ShieldWarning,
	Terminal,
	Trash,
} from "phosphor-svelte";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import type { SessionEntry } from "../../application/dto/session-entry.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { PermissionRequest } from "../../types/permission.js";
import { Colors, COLOR_NAMES } from "../../utils/colors.js";
import VoiceDownloadProgress from "$lib/components/voice-download-progress.svelte";
import PermissionActionBar from "./permission-action-bar.svelte";
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
const progressLabel = $derived.by(() => {
	if (!sessionProgress) {
		return "";
	}

	const currentStep =
		sessionProgress.completed + 1 <= sessionProgress.total
			? sessionProgress.completed + 1
			: sessionProgress.total;
	return `Permission ${currentStep} of ${sessionProgress.total}`;
});
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
	{@const purpleColor = Colors[COLOR_NAMES.PURPLE]}
	<SharedAgentPanelPermissionBar
		{verb}
		{filePath}
		showFilePath={!showEditPreview}
		{command}
	>
		{#snippet leading()}
			{#if kind === "edit"}
				<PencilSimple weight="fill" size={11} class="shrink-0" style="color: {purpleColor}" />
			{:else if kind === "read"}
				<File weight="fill" size={11} class="shrink-0" style="color: {purpleColor}" />
			{:else if kind === "execute"}
				<Terminal weight="fill" size={11} class="shrink-0" style="color: {purpleColor}" />
			{:else if kind === "search"}
				<MagnifyingGlass weight="fill" size={11} class="shrink-0" style="color: {purpleColor}" />
			{:else if kind === "fetch" || kind === "web_search"}
				<GlobeHemisphereWest weight="fill" size={11} class="shrink-0" style="color: {purpleColor}" />
			{:else if kind === "delete"}
				<Trash weight="fill" size={11} class="shrink-0" style="color: {purpleColor}" />
			{:else if kind === "move"}
				<ArrowsLeftRight weight="fill" size={11} class="shrink-0" style="color: {purpleColor}" />
			{:else}
				<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
			{/if}
		{/snippet}

		{#snippet progress()}
			{#if sessionProgress}
				<VoiceDownloadProgress
					ariaLabel={progressLabel}
					compact={true}
					label=""
					percent={sessionProgress.total > 0 ? Math.round(((sessionProgress.completed + 1) / sessionProgress.total) * 100) : 0}
					segmentCount={sessionProgress.total}
					showPercent={false}
				/>
			{/if}
		{/snippet}

		{#snippet actionBar()}
			<PermissionActionBar permission={currentPermission} hideHeader />
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
