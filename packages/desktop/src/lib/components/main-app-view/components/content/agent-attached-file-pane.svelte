<script lang="ts">
import { untrack } from "svelte";
import { AgentAttachedFilePane as SharedAgentAttachedFilePane } from "@acepe/ui/agent-panel";
import { FilePathBadge } from "@acepe/ui";
import { IconX } from "@tabler/icons-svelte";
import { FilePanel } from "$lib/acp/components/file-panel/index.js";
import { scheduleLazyPanelMetadataWork } from "$lib/acp/components/file-panel/file-panel-defer.js";
import { toFilePanelGitStatus } from "$lib/acp/components/file-panel/file-panel-git-status.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import { getPanelStore } from "$lib/acp/store/index.js";
import { gitStatusCache } from "$lib/acp/services/git-status-cache.svelte.js";
import type { FilePanel as FilePanelType } from "$lib/acp/store/file-panel-type.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";

interface Props {
	ownerPanelId: string;
	projects: readonly Project[];
	columnWidth?: number;
	isFullscreenEmbedded?: boolean;
	onSelectFilePanel: (ownerPanelId: string, panelId: string) => void;
	onCloseFilePanel: (panelId: string) => void;
	onResizeFilePanel: (panelId: string, delta: number) => void;
}

let {
	ownerPanelId,
	projects,
	columnWidth = 450,
	isFullscreenEmbedded: _isFullscreenEmbedded = false,
	onSelectFilePanel,
	onCloseFilePanel,
	onResizeFilePanel,
}: Props = $props();

const panelStore = getPanelStore();
const filePanels = $derived(panelStore.getAttachedFilePanels(ownerPanelId));

let gitStatusByFilePanelKey = $state(new Map<string, FileGitStatus | null>());

function createRetainedGitStatusMap(
	filePanels: readonly FilePanelType[],
	currentStatuses: ReadonlyMap<string, FileGitStatus | null>
): Map<string, FileGitStatus | null> {
	const nextStatuses = new Map<string, FileGitStatus | null>();
	for (const filePanel of filePanels) {
		const key = getFilePanelStatusKey(filePanel);
		nextStatuses.set(key, currentStatuses.get(key) ?? null);
	}
	return nextStatuses;
}

const activeFilePanel = $derived.by(() => {
	const activeFilePanelId = panelStore.getActiveFilePanelId(ownerPanelId);
	const selectedActiveFilePanel = panelStore.getActiveAttachedFilePanel(ownerPanelId);
	if (selectedActiveFilePanel?.ownerPanelId === ownerPanelId) {
		return selectedActiveFilePanel;
	}
	const active =
		activeFilePanelId !== null
			? filePanels.find((panel) => panel.id === activeFilePanelId)
			: undefined;
	return active ?? filePanels[0] ?? null;
});

const projectsByPath = $derived.by(() => {
	const nextProjectsByPath = new Map<string, Project>();
	for (const project of projects) {
		nextProjectsByPath.set(project.path, project);
	}
	return nextProjectsByPath;
});

const activeFileProject = $derived(
	activeFilePanel === null ? undefined : projectsByPath.get(activeFilePanel.projectPath)
);
const activeFilePanelGitStatus = $derived.by(() =>
	activeFilePanel === null
		? null
		: toFilePanelGitStatus(
				gitStatusByFilePanelKey.get(getFilePanelStatusKey(activeFilePanel)) ?? null
			)
);

$effect(() => {
	const currentFilePanels = filePanels;
	const currentActiveFilePanel = activeFilePanel;
	const currentGitStatuses = untrack(() => gitStatusByFilePanelKey);
	let cancelled = false;

	// Reset cache to currently relevant tabs only, but keep git metadata lazy.
	// Opening or switching files should not clear known badge stats for unaffected tabs,
	// and should not kick off metadata work for every attached tab either.
	// Important: keep updates based on a local map snapshot so sync test doubles or
	// immediate cache hits do not create a read/write self-dependency loop.
	let nextGitStatusByFilePanelKey = createRetainedGitStatusMap(
		currentFilePanels,
		currentGitStatuses
	);
	gitStatusByFilePanelKey = nextGitStatusByFilePanelKey;

	if (currentActiveFilePanel === null) {
		return () => {
			cancelled = true;
		};
	}

	const deferredWork = scheduleLazyPanelMetadataWork(() => {
		if (cancelled) return;

		const filePanelStatusKey = getFilePanelStatusKey(currentActiveFilePanel);
		gitStatusCache
			.getProjectFileGitStatusSummary(
				currentActiveFilePanel.projectPath,
				currentActiveFilePanel.filePath
			)
			.match(
				(fileStatus) => {
					if (cancelled) return;
					nextGitStatusByFilePanelKey = new Map(nextGitStatusByFilePanelKey);
					nextGitStatusByFilePanelKey.set(filePanelStatusKey, fileStatus);
					gitStatusByFilePanelKey = nextGitStatusByFilePanelKey;
				},
				() => {
					if (cancelled) return;
					nextGitStatusByFilePanelKey = new Map(nextGitStatusByFilePanelKey);
					nextGitStatusByFilePanelKey.set(filePanelStatusKey, null);
					gitStatusByFilePanelKey = nextGitStatusByFilePanelKey;
				}
			);
	});

	return () => {
		cancelled = true;
		deferredWork.cancel();
	};
});

function getFilePanelStatusKey(filePanel: FilePanelType): string {
	return `${filePanel.projectPath}\0${filePanel.filePath}`;
}

function getGitDiffStats(filePanel: FilePanelType): { added: number; removed: number } {
	const status = gitStatusByFilePanelKey.get(getFilePanelStatusKey(filePanel)) ?? null;
	return {
		added: status?.insertions ?? 0,
		removed: status?.deletions ?? 0,
	};
}
</script>

{#if activeFilePanel}
	<SharedAgentAttachedFilePane {columnWidth}>
		{#snippet tabs()}
			{#each filePanels as filePanel (filePanel.id)}
				{@const fileName = filePanel.filePath.split("/").pop() ?? filePanel.filePath}
				{@const diffStats = getGitDiffStats(filePanel)}
				<div
					class="attached-tab-button group inline-flex h-7 shrink-0 items-center gap-1 px-2 text-xs transition-colors {activeFilePanel.id ===
					filePanel.id
						? 'bg-accent/25 text-foreground'
						: 'text-muted-foreground hover:bg-accent/15 hover:text-foreground'}"
				>
					<button
						type="button"
						class="min-w-0"
						onclick={() => onSelectFilePanel(ownerPanelId, filePanel.id)}
						title={filePanel.filePath}
					>
						<FilePathBadge
							filePath={filePanel.filePath}
							{fileName}
							linesAdded={diffStats.added}
							linesRemoved={diffStats.removed}
							interactive={false}
							selected={activeFilePanel.id === filePanel.id}
						/>
					</button>
					<button
						type="button"
						class="inline-flex h-4 w-4 items-center justify-center rounded opacity-50 hover:opacity-100 hover:bg-muted-foreground/10"
						onclick={() => onCloseFilePanel(filePanel.id)}
						title="Close tab"
					>
						<IconX class="h-3 w-3" />
					</button>
				</div>
			{/each}
		{/snippet}

		{#snippet body()}
			<FilePanel
				panelId={activeFilePanel.id}
				filePath={activeFilePanel.filePath}
				projectPath={activeFilePanel.projectPath}
				projectName={activeFileProject?.name ?? "Unknown"}
				projectColor={activeFileProject?.color}
				projectIconSrc={activeFileProject?.iconPath ?? null}
				width={activeFilePanel.width}
				initialGitStatus={activeFilePanelGitStatus}
				isFullscreenEmbedded={true}
				hideProjectBadge={true}
				compactHeader={true}
				useReadOnlyPierreView={true}
				flatStyle={true}
				onClose={() => onCloseFilePanel(activeFilePanel.id)}
				onResize={(panelId, delta) => onResizeFilePanel(panelId, delta)}
			/>
		{/snippet}
	</SharedAgentAttachedFilePane>
{/if}

<style>
	.attached-tab-button :global(.file-path-badge),
	.attached-tab-button :global(.file-path-badge:hover),
	.attached-tab-button :global(.file-path-badge-selected) {
		background: transparent !important;
	}
</style>
