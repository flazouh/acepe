<script lang="ts">
import { FilePathBadge } from "@acepe/ui";
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

const pendingPermissions = $derived.by(() => {
	const result: PermissionRequest[] = [];
	for (const p of permissionStore.pending.values()) {
		if (p.sessionId === sessionId) {
			result.push(p);
		}
	}
	return result;
});

function extractCommand(permission: PermissionRequest): string | null {
	return extractPermissionCommand(permission);
}

function extractFilePath(permission: PermissionRequest): string | null {
	const path = extractPermissionFilePath(permission);
	if (!path) return null;
	return makeWorkspaceRelative(path, projectPath ?? "");
}

function extractVerb(
	permission: PermissionRequest,
	filePath: string | null,
	command: string | null
): string {
	if (filePath || command) {
		return permission.permission.split(" ")[0] ?? permission.permission;
	}
	return permission.permission;
}
</script>

{#if pendingPermissions.length > 0}
	<div class="w-full px-5 mb-1">
		<div class="flex flex-col gap-1">
			{#each pendingPermissions as permission (permission.id)}
				{@const command = extractCommand(permission)}
				{@const filePath = extractFilePath(permission)}
				{@const verb = extractVerb(permission, filePath, command)}
				<div class="permission-bar-item">
					<div class="flex items-start flex-wrap gap-2 min-w-0">
						<ShieldWarning weight="fill" class="size-3.5 text-primary shrink-0" />
						<span class="text-xs font-medium text-muted-foreground shrink-0">{verb}</span>
						{#if filePath}
							<FilePathBadge {filePath} iconBasePath="/svgs/icons" interactive={false} />
						{:else if command}
							<code class="text-xs text-foreground/80 truncate font-mono min-w-0 flex-1"
								>$ {command}</code
							>
						{/if}
					</div>
					<PermissionActionBar {permission} />
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.permission-bar-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
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
