<script lang="ts">
import { FilePanelHeader as FilePanelHeaderLayout } from "@acepe/ui/file-panel";
import { CloseAction, EmbeddedIconButton } from "@acepe/ui/panel-header";
import { FolderOpen } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { FileIcon } from "$lib/components/ui/file-icon/index.js";
import * as m from "$lib/messages.js";
import { revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
import CopyButton from "../messages/copy-button.svelte";
import type { FilePanelDisplayMode } from "./file-panel-format.js";

interface Props {
	fileName: string;
	filePath: string;
	projectPath: string;
	projectName: string;
	projectColor: string | undefined;
	content: string | null;
	gitStatus: { status: string; insertions: number; deletions: number } | null;
	compact?: boolean;
	hideProjectBadge?: boolean;
	displayModes?: readonly FilePanelDisplayMode[];
	activeDisplayMode?: FilePanelDisplayMode;
	onDisplayModeChange?: ((mode: FilePanelDisplayMode) => void) | undefined;
	editorModes?: readonly ("write" | "read")[];
	activeEditorMode?: "write" | "read";
	onEditorModeChange?: ((mode: "write" | "read") => void) | undefined;
	onClose: () => void;
}

let {
	fileName,
	filePath,
	projectPath,
	projectName,
	projectColor,
	content,
	gitStatus,
	compact = false,
	hideProjectBadge = false,
	displayModes = [],
	activeDisplayMode = "raw",
	onDisplayModeChange,
	editorModes = [],
	activeEditorMode = "write",
	onEditorModeChange,
	onClose,
}: Props = $props();

const effectiveColor = $derived(projectColor ?? "");

function handleOpenInFinder() {
	tauriClient.fileIndex
		.resolveFilePath(filePath, projectPath)
		.andThen(revealInFinder)
		.mapErr(() => {
			toast.error(m.file_panel_open_in_finder_error());
		});
}

function getFullPath(): string {
	return filePath.startsWith("/") ? filePath : `${projectPath}/${filePath}`;
}

function getDisplayModeLabel(mode: FilePanelDisplayMode): string {
	if (mode === "rendered") return m.plan_preview();
	if (mode === "structured") return "Tree";
	if (mode === "table") return "Table";
	return m.plan_source();
}

const uiDisplayModes = $derived(
	displayModes.map((mode) => ({ id: mode, label: getDisplayModeLabel(mode) }))
);

const uiEditorModes = $derived(
	editorModes.map((mode) => ({
		id: mode,
		label: mode === "write" ? "Write" : "Read",
	}))
);

function handleDisplayModeChange(modeId: string) {
	onDisplayModeChange?.(modeId as FilePanelDisplayMode);
}

function handleEditorModeChange(modeId: string) {
	onEditorModeChange?.(modeId as "write" | "read");
}
</script>

<FilePanelHeaderLayout
	{fileName}
	{filePath}
	{projectName}
	projectColor={effectiveColor}
	{compact}
	{hideProjectBadge}
	insertions={gitStatus?.insertions}
	deletions={gitStatus?.deletions}
	hasContent={content !== null}
	displayModes={uiDisplayModes}
	{activeDisplayMode}
	onDisplayModeChange={onDisplayModeChange ? handleDisplayModeChange : undefined}
	editorModes={uiEditorModes}
	{activeEditorMode}
	onEditorModeChange={onEditorModeChange ? handleEditorModeChange : undefined}
	{onClose}
>
	{#snippet fileIcon()}
		{#if !compact}
			<FileIcon extension={fileName} class="h-4 w-4 shrink-0" />
		{/if}
	{/snippet}

	{#snippet fileLabel()}
		{#if !compact}
			<CopyButton
				getText={getFullPath}
				variant="inline"
				label={fileName}
				size={14}
				class="text-sm truncate min-w-0"
				title={filePath}
			/>
		{/if}
	{/snippet}

	{#snippet actions()}
		{#if compact}
			<div class="h-7 w-7 inline-flex items-center justify-center" data-header-control>
				<CopyButton
					getText={getFullPath}
					variant="icon"
					size={14}
					class="h-7 w-7 text-muted-foreground hover:text-foreground"
					title={m.button_copy()}
				/>
			</div>
		{/if}
		<EmbeddedIconButton onclick={handleOpenInFinder} title={m.file_panel_open_in_finder()}>
			<FolderOpen class="h-3.5 w-3.5" weight="fill" />
			<span class="sr-only">{m.file_panel_open_in_finder()}</span>
		</EmbeddedIconButton>
		{#if !compact}
			<CloseAction onClose={onClose} title={m.common_close()} />
		{/if}
	{/snippet}
</FilePanelHeaderLayout>
