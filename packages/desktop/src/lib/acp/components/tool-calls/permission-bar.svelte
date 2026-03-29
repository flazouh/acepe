<script lang="ts">
	import { FilePathBadge, ToolTally } from "@acepe/ui";
	import ShieldWarning from "phosphor-svelte/lib/ShieldWarning";
	import { getPermissionStore } from "../../store/permission-store.svelte.js";
	import type { PermissionRequest } from "../../types/permission.js";
	import { makeWorkspaceRelative } from "../../utils/path-utils.js";
	import PermissionActionBar from "./permission-action-bar.svelte";
	import { extractPermissionCommand, extractPermissionFilePath } from "./permission-display.js";

 	interface Props {
		sessionId: string;
		isFullscreen?: boolean;
		projectPath?: string | null;
	}

	let { sessionId, isFullscreen = false, projectPath = null }: Props = $props();

	const permissionStore = getPermissionStore();

	const pendingPermissions = $derived.by(() => permissionStore.getForSession(sessionId));
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

	function extractVerb(
		permission: PermissionRequest,
		filePath: string | null,
		command: string | null
	): string {
		if (filePath || command) {
			const firstWord = permission.permission.split(" ")[0];
			return firstWord ? firstWord : permission.permission;
		}
		return permission.permission;
	}
</script>


{#if currentPermission}
	{@const command = extractCommand(currentPermission)}
	{@const filePath = extractFilePath(currentPermission)}
	{@const verb = extractVerb(currentPermission, filePath, command)}
	<div class="w-full px-5 mb-1">
		<div class="flex flex-col gap-1">
			<div class="permission-bar-item">
				<div class="flex w-full min-w-0 items-start justify-between gap-3">
					<div class="flex min-w-0 flex-1 flex-col gap-2">
						<div class="flex min-w-0 items-start gap-2">
							<ShieldWarning weight="fill" class="size-3.5 text-primary shrink-0" />
							<span class="text-xs font-medium text-muted-foreground shrink-0">{verb}</span>
							{#if filePath}
								<div class="min-w-0 flex-1">
									<FilePathBadge {filePath} iconBasePath="/svgs/icons" interactive={false} />
								</div>
							{/if}
						</div>
						{#if command}
							<div class="min-w-0 overflow-hidden rounded-md border border-border/60 bg-background/45 px-2.5 py-1.5">
								<code class="block min-w-0 whitespace-pre-wrap break-all font-mono text-xs text-foreground/80"
									>$ {command}</code
								>
							</div>
						{/if}
					</div>
					{#if sessionProgress}
						<div class="shrink-0 pt-0.5">
							<ToolTally
								mode="progress"
								totalCount={sessionProgress.total}
								filledCount={sessionProgress.completed}
								ariaLabel={progressLabel}
								inline={true}
							/>
						</div>
					{/if}
				</div>
				<div class="self-start">
					<PermissionActionBar permission={currentPermission} />
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.permission-bar-item {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--accent) 72%, var(--card) 28%);
		border: 1px solid var(--border);
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
