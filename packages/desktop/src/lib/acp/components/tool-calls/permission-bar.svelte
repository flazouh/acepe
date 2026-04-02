<script lang="ts">
	import { FilePathBadge } from "@acepe/ui";
	import ShieldWarning from "phosphor-svelte/lib/ShieldWarning";
	import { getPermissionStore } from "../../store/permission-store.svelte.js";
	import { getSessionStore } from "../../store/session-store.svelte.js";
	import type { PermissionRequest } from "../../types/permission.js";
	import { makeWorkspaceRelative } from "../../utils/path-utils.js";
	import { Colors, COLOR_NAMES } from "../../utils/colors.js";
	import VoiceDownloadProgress from "$lib/components/voice-download-progress.svelte";
	import { shouldHidePermissionBarForExitPlan } from "./exit-plan-helpers.js";
	import PermissionActionBar from "./permission-action-bar.svelte";
	import { extractPermissionCommand, extractPermissionFilePath, extractPermissionToolKind } from "./permission-display.js";

 	interface Props {
		sessionId: string;
		isFullscreen?: boolean;
		projectPath?: string | null;
	}

	let { sessionId, isFullscreen = false, projectPath = null }: Props = $props();

	const permissionStore = getPermissionStore();
	const sessionStore = getSessionStore();

	const pendingPermissions = $derived.by(() => {
		const entries = sessionStore.getEntries(sessionId);
		const visiblePermissions: PermissionRequest[] = [];

		for (const permission of permissionStore.getForSession(sessionId)) {
			if (shouldHidePermissionBarForExitPlan(permission, entries)) {
				continue;
			}

			visiblePermissions.push(permission);
		}

		return visiblePermissions;
	});
	const currentPermission = $derived(pendingPermissions.length > 0 ? pendingPermissions[0] : null);
	const sessionProgress = $derived(permissionStore.getSessionProgress(sessionId));
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

	function extractCommand(permission: PermissionRequest): string | null {
		return extractPermissionCommand(permission);
	}

	function extractFilePath(permission: PermissionRequest): string | null {
		const path = extractPermissionFilePath(permission);
		if (!path) return null;
		const basePath = projectPath ? projectPath : "";
		return makeWorkspaceRelative(path, basePath);
	}

	function extractVerb(permission: PermissionRequest): string {
		return extractPermissionToolKind(permission);
	}
</script>


{#if currentPermission}
	{@const command = extractCommand(currentPermission)}
	{@const filePath = command ? null : extractFilePath(currentPermission)}
	{@const verb = extractVerb(currentPermission)}
	{@const purpleColor = Colors[COLOR_NAMES.PURPLE]}
	<div class="mx-auto w-full max-w-[320px] px-3">
		<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1 permission-card-enter">
			<!-- Header row: verb + file path (when no command) + progress -->
			<div class="flex min-w-0 items-center gap-1.5">
				<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
				<span class="text-[10px] font-mono font-medium text-muted-foreground shrink-0">{verb}</span>
				{#if filePath}
					<div class="min-w-0 flex-1">
						<FilePathBadge {filePath} iconBasePath="/svgs/icons" interactive={false} size="sm" />
					</div>
				{/if}
				{#if sessionProgress}
					<div class="shrink-0 ml-auto">
						<VoiceDownloadProgress
							ariaLabel={progressLabel}
							compact={true}
							label=""
							percent={sessionProgress.total > 0 ? Math.round(((sessionProgress.completed + 1) / sessionProgress.total) * 100) : 0}
							segmentCount={sessionProgress.total}
							showPercent={false}
						/>
					</div>
				{/if}
			</div>

			<!-- Command display (file path is visible inside the command) -->
			{#if command}
				<div class="max-h-[72px] overflow-y-auto rounded-sm bg-accent/40 px-2 py-1">
					<code class="block min-w-0 whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/70"
						>$ {command}</code
					>
				</div>
			{/if}

			<!-- Action buttons: full width -->
			<div class="flex items-center">
				<PermissionActionBar permission={currentPermission} />
			</div>
		</div>
	</div>
{/if}

<style>
	.permission-card-enter {
		animation: slideUp 0.2s ease-out;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
