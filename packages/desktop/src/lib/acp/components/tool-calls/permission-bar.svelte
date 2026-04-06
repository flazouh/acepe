<script lang="ts">
	import { FilePathBadge } from "@acepe/ui/file-path-badge";
	import { EmbeddedPanelHeader, HeaderActionCell, HeaderTitleCell } from "@acepe/ui/panel-header";
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
	import type { PermissionRequest } from "../../types/permission.js";
	import { Colors, COLOR_NAMES } from "../../utils/colors.js";
	import VoiceDownloadProgress from "$lib/components/voice-download-progress.svelte";
	import PermissionActionBar from "./permission-action-bar.svelte";
	import { extractCompactPermissionDisplay } from "./permission-display.js";
	import { visiblePermissionsForSessionBar } from "./permission-visibility.js";

 	interface Props {
		sessionId: string;
		permission?: PermissionRequest | null;
		isFullscreen?: boolean;
		projectPath?: string | null;
	}

	let { sessionId, permission = null, isFullscreen = false, projectPath = null }: Props = $props();

	const permissionStore = getPermissionStore();
	const sessionStore = getSessionStore();

	const pendingPermissions = $derived.by(() => {
		if (permission) {
			return [permission];
		}

		const entries = sessionStore.getEntries(sessionId);
		return visiblePermissionsForSessionBar(permissionStore.getForSession(sessionId), entries);
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

</script>


{#if currentPermission}
	{@const compactDisplay = extractCompactPermissionDisplay(currentPermission, projectPath)}
	{@const kind = compactDisplay.kind}
	{@const command = compactDisplay.command}
	{@const filePath = compactDisplay.filePath}
	{@const verb = compactDisplay.label}
	{@const purpleColor = Colors[COLOR_NAMES.PURPLE]}
	<div class="w-full">
		<div class="overflow-hidden rounded-md border border-border bg-muted/30 permission-card-enter">
			<EmbeddedPanelHeader class={command ? "bg-transparent" : "!border-b-0 bg-transparent"}>
				<HeaderTitleCell compactPadding>
					<div class="flex min-w-0 items-center gap-1.5 w-full">
						<span
							class="inline-flex shrink-0 items-center justify-center"
							aria-label={verb}
							title={verb}
						>
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
						</span>
						<span class="shrink-0 text-[10px] font-medium text-muted-foreground">{verb}</span>
						{#if filePath}
							<div class="min-w-0 flex-1 cursor-pointer">
								<FilePathBadge {filePath} interactive={false} size="sm" />
							</div>
						{/if}
					</div>
				</HeaderTitleCell>
				<HeaderActionCell withDivider={false}>
					<div class="flex items-center px-1">
						<PermissionActionBar permission={currentPermission} inline hideHeader />
					</div>
				</HeaderActionCell>
				{#if sessionProgress}
					<HeaderActionCell withDivider={false}>
						<div class="flex items-center px-1.5">
							<VoiceDownloadProgress
								ariaLabel={progressLabel}
								compact={true}
								label=""
								percent={sessionProgress.total > 0 ? Math.round(((sessionProgress.completed + 1) / sessionProgress.total) * 100) : 0}
								segmentCount={sessionProgress.total}
								showPercent={false}
							/>
						</div>
					</HeaderActionCell>
				{/if}
			</EmbeddedPanelHeader>

			<!-- Command display for execute permissions -->
			{#if command}
				<div class="max-h-[72px] overflow-y-auto border-t border-border/50 bg-muted/30 px-2 py-1">
					<code class="block min-w-0 whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/70"
						>$ {command}</code
					>
				</div>
			{/if}

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
