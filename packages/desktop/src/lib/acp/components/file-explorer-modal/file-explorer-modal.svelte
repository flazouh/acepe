<script lang="ts">
/**
 * FileExplorerModal
 *
 * Full-screen Cmd+I file explorer modal. Splits into a left results list and
 * a right preview pane. Manages debounced search and keyboard navigation.
 *
 * Props:
 *   - projectPath: the project being searched
 *   - onClose: called when the user dismisses the modal (Escape or backdrop click)
 *   - onInsert: called with the selected file path when the user presses Enter
 */
import { onMount } from "svelte";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { FileExplorerRow } from "$lib/services/converted-session-types.js";
import { FileExplorerModalState } from "./file-explorer-modal-state.svelte.js";
import FileExplorerPreviewPane from "./file-explorer-preview-pane.svelte";
import FileExplorerResultsList from "./file-explorer-results-list.svelte";

interface Props {
	projectPaths: string[];
	projectInfoByPath: Record<string, { name: string; color: string }>;
	onClose: () => void;
	onInsert: (projectPath: string, filePath: string) => void;
}

const props = $props<Props>();
const { onClose, onInsert, projectInfoByPath } = props;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const explorerState = new FileExplorerModalState({
	projectPaths: props.projectPaths,
	searchFn: async (projectPaths, query, limit, offset) => {
		const settled = await Promise.all(
			projectPaths.map((projectPath) =>
				tauriClient.fileIndex.searchProjectFilesForExplorer(projectPath, query, limit, 0).match(
					(response) =>
						response.rows.map((row) => ({
							projectPath,
							path: row.path,
							fileName: row.fileName,
							extension: row.extension,
							pathSegments: row.pathSegments,
							gitStatus: row.gitStatus,
							isTracked: row.isTracked,
							isBinary: row.isBinary,
							lastModifiedMs: row.lastModifiedMs,
							sizeBytes: row.sizeBytes,
							previewKind: row.previewKind,
						})),
					() => []
				)
			)
		);

		const allRows = settled.flat();
		const projectOrder = projectPaths.reduce<Record<string, number>>((acc, projectPath, index) => {
			acc[projectPath] = index;
			return acc;
		}, {});
		allRows.sort((a, b) => {
			const aProjectIndex = projectOrder[a.projectPath];
			const bProjectIndex = projectOrder[b.projectPath];
			if (aProjectIndex !== bProjectIndex) return aProjectIndex - bProjectIndex;
			const aDiff = a.gitStatus ? a.gitStatus.insertions + a.gitStatus.deletions : 0;
			const bDiff = b.gitStatus ? b.gitStatus.insertions + b.gitStatus.deletions : 0;
			if (bDiff !== aDiff) return bDiff - aDiff;
			return a.path.localeCompare(b.path);
		});
		const rows = allRows.slice(offset, offset + limit);
		return {
			projectPath: projectPaths[0] ? projectPaths[0] : "",
			query,
			total: allRows.length,
			rows,
		};
	},
	previewFn: (path, filePath) =>
		tauriClient.fileIndex
			.getFileExplorerPreview(path, filePath)
			.match(
				(r) => r,
				(_e) => ({
					kind: "fallback" as const,
					file_path: filePath,
					file_name: filePath.split("/").pop()
						? filePath.split("/").pop()!
						: filePath,
					reason: "Failed to load preview",
					size_bytes: null,
					git_status: null,
					preview_kind: "text" as const,
				})
			),
});

// Debounce handle
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 150;

let inputRef: HTMLInputElement | null = $state(null);

// ---------------------------------------------------------------------------
// On open: fire initial (empty) search and focus the input
// ---------------------------------------------------------------------------

onMount(() => {
	void explorerState.searchNow();
	if (inputRef) {
		inputRef.focus();
	}
});

// ---------------------------------------------------------------------------
// Search debouncing
// ---------------------------------------------------------------------------

function handleInput(event: Event) {
	const target = event.target as HTMLInputElement;
	explorerState.setQuery(target.value);

	if (debounceTimer !== null) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		void explorerState.searchNow();
	}, DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Keyboard handler
// ---------------------------------------------------------------------------

function handleKeyDown(event: KeyboardEvent) {
	switch (event.key) {
		case "ArrowDown":
			event.preventDefault();
			explorerState.navigateDown();
			triggerPreviewLoad();
			break;
		case "ArrowUp":
			event.preventDefault();
			explorerState.navigateUp();
			triggerPreviewLoad();
			break;
		case "Enter": {
			event.preventDefault();
			const row = explorerState.selectedRow;
			if (row !== null) {
				onInsert(row.projectPath, row.path);
				onClose();
			}
			break;
		}
		case "Escape":
			event.preventDefault();
			onClose();
			break;
		default:
			break;
	}
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

function triggerPreviewLoad() {
	const row = explorerState.selectedRow;
	if (row !== null) {
		void explorerState.loadPreview(row.path);
	}
}

function handleSelect(row: FileExplorerRow) {
	const idx = explorerState.rows.indexOf(row);
	if (idx !== -1) {
		explorerState.selectedIndex = idx;
	}
	void explorerState.loadPreview(row.path);
}
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="fixed inset-0 z-[9995] flex items-center justify-center bg-black/55 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="File Explorer"
	tabindex="-1"
	onclick={(event) => {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}}
	onkeydown={(e) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			onClose();
		}
	}}
>
	<!-- Modal panel -->
	<div
		class="h-[min(600px,calc(100vh-2rem))] w-full max-w-[900px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_30px_80px_rgba(0,0,0,0.5)] flex flex-col"
	>
		<!-- Search input row -->
		<div class="flex items-center gap-1 px-2.5 py-1.5 border-b shrink-0">
			<svg
				class="h-3 w-3 text-muted-foreground shrink-0"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<circle cx="11" cy="11" r="8" />
				<path d="m21 21-4.35-4.35" />
			</svg>
			<input
				bind:this={inputRef}
				type="text"
				placeholder="Search files…"
				autocomplete="off"
				autocapitalize="off"
				spellcheck={false}
				class="flex-1 bg-transparent border-none outline-none text-[12px] placeholder:text-muted-foreground"
				value={explorerState.query}
				oninput={handleInput}
				onkeydown={handleKeyDown}
				aria-label="Search files"
				aria-controls="file-explorer-results"
				aria-activedescendant={explorerState.rows.length > 0
					? `file-explorer-row-${explorerState.selectedIndex}`
					: undefined}
			/>
			<kbd
				class="px-1 py-0 text-[8px] font-medium bg-muted rounded border text-muted-foreground leading-[1.1]"
			>
				Esc
			</kbd>
		</div>

		<!-- Body: results + preview -->
		<div class="flex-1 min-h-0 flex overflow-hidden">
			<!-- Left: results list -->
			<div class="w-72 shrink-0 border-r flex flex-col min-h-0">
				<FileExplorerResultsList
					state={explorerState}
					{projectInfoByPath}
					onSelect={handleSelect}
				/>

				<!-- Footer hint -->
				{#if explorerState.rows.length > 0}
					<div
						class="px-3 py-1.5 border-t bg-muted/30 flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground"
					>
						<kbd class="px-1 py-0.5 font-medium bg-muted rounded border">↑↓</kbd>
						<span>navigate</span>
						<kbd class="px-1 py-0.5 font-medium bg-muted rounded border ml-2">↵</kbd>
						<span>open file</span>
					</div>
				{/if}
			</div>

			<!-- Right: preview pane -->
			<div class="flex-1 min-w-0 min-h-0 flex flex-col">
				<FileExplorerPreviewPane preview={explorerState.preview} />
			</div>
		</div>
	</div>
</div>
