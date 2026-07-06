<script lang="ts">
import { FilePanelHeader as FilePanelHeaderLayout } from "@acepe/ui/file-panel";
import { Button, RoundedIcon } from "@acepe/ui";
import { CloseAction } from "@acepe/ui/panel-header";
import { toast } from "svelte-sonner";
import { FileIcon } from "$lib/components/ui/file-icon/index.js";
import { revealInFinder, tauriClient } from "$lib/utils/tauri-client.js";
import CopyButton from "../messages/copy-button.svelte";
import type { FilePanelDisplayMode } from "./format/types.js";
import {
	getFilePanelDisplayModeItems,
	getFilePanelEditorModeItems,
	getFilePanelEffectiveProjectColor,
	getFilePanelFullPath,
} from "./file-panel-header-state.js";

interface Props {
	fileName: string;
	filePath: string;
	projectPath: string;
	projectName: string;
	projectColor: string | undefined;
	projectIconSrc?: string | null;
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
	projectIconSrc = null,
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

const effectiveColor = $derived(getFilePanelEffectiveProjectColor(projectColor));

function handleOpenInFinder() {
	tauriClient.fileIndex
		.resolveFilePath(filePath, projectPath)
		.andThen(revealInFinder)
		.mapErr(() => {
			toast.error("Failed to open in Finder");
		});
}

const fullPath = $derived(getFilePanelFullPath({ filePath, projectPath }));
const uiDisplayModes = $derived(getFilePanelDisplayModeItems(displayModes));
const uiEditorModes = $derived(getFilePanelEditorModeItems(editorModes));

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
	{projectIconSrc}
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
				getText={() => fullPath}
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
					getText={() => fullPath}
					variant="icon"
					size={14}
					class="h-7 w-7 text-muted-foreground hover:text-foreground"
					title={"Copy"}
				/>
			</div>
		{/if}
		<Button
			variant="ghost"
			size="icon-2xs"
			data-header-control
			onclick={handleOpenInFinder}
			title="Open in Finder"
			aria-label="Open in Finder"
		>
			{#snippet children()}
				<RoundedIcon name="folder" />
				<span class="sr-only">{"Open in Finder"}</span>
			{/snippet}
		</Button>
		{#if !compact}
			<CloseAction onClose={onClose} title={"Close"} />
		{/if}
	{/snippet}
</FilePanelHeaderLayout>
