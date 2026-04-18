<script lang="ts">
import { AgentAttachedFilePane as SharedAgentAttachedFilePane } from "@acepe/ui/agent-panel";
import { FilePathBadge } from "@acepe/ui";
import { IconX } from "@tabler/icons-svelte";
import { FilePanel } from "$lib/acp/components/file-panel/index.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import { gitStatusCache } from "$lib/acp/services/git-status-cache.svelte.js";
import type { FilePanel as FilePanelType } from "$lib/acp/store/file-panel-type.js";
import { findGitStatusForFile, getRelativeFilePath } from "$lib/acp/utils/file-utils.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";

interface Props {
	ownerPanelId: string;
	filePanels: readonly FilePanelType[];
	activeFilePanelId: string | null;
	projects: readonly Project[];
	columnWidth?: number;
	isFullscreenEmbedded?: boolean;
	onSelectFilePanel: (ownerPanelId: string, panelId: string) => void;
	onCloseFilePanel: (panelId: string) => void;
	onResizeFilePanel: (panelId: string, delta: number) => void;
}

let {
	ownerPanelId,
	filePanels,
	activeFilePanelId,
	projects,
	columnWidth = 450,
	isFullscreenEmbedded: _isFullscreenEmbedded = false,
	onSelectFilePanel,
	onCloseFilePanel,
	onResizeFilePanel,
}: Props = $props();

const EMPTY_GIT_STATUS_MAP: ReadonlyMap<string, FileGitStatus> = new Map();

let gitStatusMapsByProjectPath = $state(new Map<string, ReadonlyMap<string, FileGitStatus>>());

const activeFilePanel = $derived.by(() => {
	const active =
		activeFilePanelId !== null
			? filePanels.find((panel) => panel.id === activeFilePanelId)
			: undefined;
	return active ?? filePanels[0] ?? null;
});

const panelProjectPaths = $derived.by(() =>
	Array.from(new Set(filePanels.map((panel) => panel.projectPath)))
);

$effect(() => {
	const currentProjectPaths = panelProjectPaths;
	let cancelled = false;

	// Reset cache to currently relevant projects only.
	// Important: keep updates based on a local map snapshot so sync test doubles or
	// immediate cache hits do not create a read/write self-dependency loop.
	let nextStatusMapsByProjectPath = new Map<string, ReadonlyMap<string, FileGitStatus>>();
	for (const projectPath of currentProjectPaths) {
		nextStatusMapsByProjectPath.set(projectPath, EMPTY_GIT_STATUS_MAP);
	}
	gitStatusMapsByProjectPath = nextStatusMapsByProjectPath;

	for (const projectPath of currentProjectPaths) {
		gitStatusCache.getProjectGitStatusMap(projectPath).match(
			(statusMap) => {
				if (cancelled) return;
				nextStatusMapsByProjectPath = new Map(nextStatusMapsByProjectPath);
				nextStatusMapsByProjectPath.set(projectPath, statusMap);
				gitStatusMapsByProjectPath = nextStatusMapsByProjectPath;
			},
			() => {
				if (cancelled) return;
				nextStatusMapsByProjectPath = new Map(nextStatusMapsByProjectPath);
				nextStatusMapsByProjectPath.set(projectPath, EMPTY_GIT_STATUS_MAP);
				gitStatusMapsByProjectPath = nextStatusMapsByProjectPath;
			}
		);
	}

	return () => {
		cancelled = true;
	};
});

function getGitDiffStats(filePanel: FilePanelType): { added: number; removed: number } {
	const statusMap = gitStatusMapsByProjectPath.get(filePanel.projectPath) ?? EMPTY_GIT_STATUS_MAP;
	const relativeFilePath = getRelativeFilePath(filePanel.filePath, filePanel.projectPath);
	const exactFileStatus = relativeFilePath ? (statusMap.get(relativeFilePath) ?? null) : null;
	const fileStatus =
		exactFileStatus ??
		findGitStatusForFile(Array.from(statusMap.values()), filePanel.filePath, filePanel.projectPath);
	return {
		added: fileStatus?.insertions ?? 0,
		removed: fileStatus?.deletions ?? 0,
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
				projectName={projects.find((project) => project.path === activeFilePanel.projectPath)?.name ??
					"Unknown"}
				projectColor={projects.find((project) => project.path === activeFilePanel.projectPath)?.color}
				projectIconSrc={projects.find((project) => project.path === activeFilePanel.projectPath)?.iconPath ??
					null}
				width={activeFilePanel.width}
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
