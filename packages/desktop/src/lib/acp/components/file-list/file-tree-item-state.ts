import type { FileTreeNode } from "./file-list-types.js";

export function getFileTreeItemFullPath(input: {
	projectPath: string;
	nodePath: string;
}): string {
	const projectPath = input.projectPath.replace(/\/$/, "");
	return input.nodePath ? `${projectPath}/${input.nodePath}` : projectPath;
}

export function getFileTreeItemParentPath(node: Pick<FileTreeNode, "path" | "isDirectory">): string {
	if (node.isDirectory) return node.path;
	if (!node.path.includes("/")) return "";
	return node.path.replace(/\/[^/]+$/, "");
}

export function getFileTreeItemIndentPx(depth: number): number {
	return depth * 12;
}

export function getFileTreeItemNameColor(
	node: Pick<FileTreeNode, "isDirectory" | "hasModifiedDescendants" | "gitStatus">
): string | null {
	if (node.isDirectory) {
		return node.hasModifiedDescendants ? "#E2BF8D" : null;
	}

	const status = node.gitStatus?.status;
	if (status === "M") return "#E2BF8D";
	if (status === "A" || status === "?") return "var(--success)";
	if (status === "D") return "#FF5D5A";
	if (status === "R") return "#E2BF8D";
	return null;
}

export function hasFileTreeItemDiff(
	node: Pick<FileTreeNode, "gitStatus">
): boolean {
	return Boolean(
		node.gitStatus && (node.gitStatus.insertions > 0 || node.gitStatus.deletions > 0)
	);
}

export function canShowFileTreeItemActions(input: {
	isRenaming: boolean;
	onCopyPath?: unknown;
	onRevealInFinder?: unknown;
	onRefresh?: unknown;
	onDelete?: unknown;
	onDeleteConfirm?: unknown;
	onRename?: unknown;
	onDuplicate?: unknown;
	onNewFile?: unknown;
	onNewFolder?: unknown;
}): boolean {
	if (input.isRenaming) return false;
	return Boolean(
		input.onCopyPath ||
			input.onRevealInFinder ||
			input.onRefresh ||
			input.onDelete ||
			input.onDeleteConfirm ||
			input.onRename ||
			input.onDuplicate ||
			input.onNewFile ||
			input.onNewFolder
	);
}

export function shouldShowFileTreeItemDuplicate(input: {
	onDuplicate?: unknown;
	isDirectory: boolean;
}): boolean {
	return Boolean(input.onDuplicate && !input.isDirectory);
}

export function getFileTreeItemRenameSubmission(input: {
	renameInput: string;
	currentName: string;
}): string | null {
	const trimmed = input.renameInput.trim();
	if (!trimmed || trimmed === input.currentName) return null;
	return trimmed;
}
