import type {
	ContextMenuButtonVisibility,
	ContextMenuTriggerMode,
	FileTreeDensity,
	FileTreeIcons,
	FileTreeInitialExpansion,
	FileTreeRowDecoration,
	GitStatusEntry,
} from "@pierre/trees";

export interface PierreFileTreeActionItem {
	kind: "directory" | "file";
	name: string;
	path: string;
}

export interface PierreFileTreeRowAction {
	id: string;
	label: string;
	title?: string;
	iconText?: string;
	destructive?: boolean;
	disabled?: boolean;
	onSelect: (path: string) => void;
}

export type PierreFileTreeRowActionProvider = (
	item: PierreFileTreeActionItem,
) => readonly PierreFileTreeRowAction[];

export type PierreFileTreeRowDecorationProvider = (
	item: PierreFileTreeActionItem,
) => FileTreeRowDecoration | null;

export interface PierreFileTreeProps {
	paths: readonly string[];
	selectedPath?: string | null;
	selectedPaths?: readonly string[];
	onSelectionChange?: (selectedPaths: readonly string[]) => void;
	gitStatus?: readonly GitStatusEntry[];
	icons?: FileTreeIcons;
	rowActions?:
		| readonly PierreFileTreeRowAction[]
		| PierreFileTreeRowActionProvider;
	rowDecoration?: PierreFileTreeRowDecorationProvider;
	contextMenuTriggerMode?: ContextMenuTriggerMode;
	contextMenuButtonVisibility?: ContextMenuButtonVisibility;
	initialExpansion?: FileTreeInitialExpansion;
	initialExpandedPaths?: readonly string[];
	flattenEmptyDirectories?: boolean;
	density?: FileTreeDensity;
	itemHeight?: number;
	overscan?: number;
	stickyFolders?: boolean;
	revealPath?: string | null;
	unsafeCSS?: string;
	id?: string;
	class?: string;
	testId?: string;
	ariaLabel?: string;
	showControls?: boolean;
}
