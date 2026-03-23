/**
 * Pure functions for building a file tree from flat file paths.
 * Extracted from desktop file-list-logic.ts as a generic, dumb version.
 */

export interface FileTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children: FileTreeNode[];
	extension: string;
	depth: number;
}

/**
 * Build a tree from a flat list of file paths.
 */
export function buildFileTree(paths: string[]): FileTreeNode[] {
	const root = new Map<string, FileTreeNode>();

	for (const filePath of paths) {
		const parts = filePath.split("/");
		let currentPath = "";

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isLast = i === parts.length - 1;
			currentPath = currentPath ? `${currentPath}/${part}` : part;

			const existing = findNodeByPath(root, currentPath);
			if (!existing) {
				const ext = isLast ? (part.lastIndexOf(".") > 0 ? part.slice(part.lastIndexOf(".") + 1) : "") : "";
				const node: FileTreeNode = {
					name: part,
					path: currentPath,
					isDirectory: !isLast,
					children: [],
					extension: ext,
					depth: i,
				};

				if (i === 0) {
					root.set(part, node);
				} else {
					const parentPath = parts.slice(0, i).join("/");
					const parent = findNodeByPath(root, parentPath);
					if (parent) {
						parent.children.push(node);
					}
				}
			}
		}
	}

	const result = Array.from(root.values());
	sortFileTree(result);
	return result;
}

function findNodeByPath(root: Map<string, FileTreeNode>, path: string): FileTreeNode | null {
	const parts = path.split("/");
	let current: FileTreeNode | undefined;

	for (let i = 0; i < parts.length; i++) {
		if (i === 0) {
			current = root.get(parts[i]);
		} else if (current) {
			current = current.children.find((c) => c.name === parts[i]);
		}
		if (!current) return null;
	}

	return current ?? null;
}

/**
 * Sort: directories first, then alphabetically.
 */
function sortFileTree(nodes: FileTreeNode[]): void {
	nodes.sort((a, b) => {
		if (a.isDirectory && !b.isDirectory) return -1;
		if (!a.isDirectory && b.isDirectory) return 1;
		return a.name.localeCompare(b.name);
	});
	for (const node of nodes) {
		if (node.children.length > 0) {
			sortFileTree(node.children);
		}
	}
}

/**
 * Flatten a tree to a visible list based on expanded folders.
 */
export function flattenFileTree(
	nodes: FileTreeNode[],
	expandedFolders: Set<string>
): FileTreeNode[] {
	const result: FileTreeNode[] = [];

	function traverse(nodeList: FileTreeNode[]): void {
		for (const node of nodeList) {
			result.push(node);
			if (node.isDirectory && expandedFolders.has(node.path)) {
				traverse(node.children);
			}
		}
	}

	traverse(nodes);
	return result;
}

/**
 * Collapse single-child directory chains into one node for compact display.
 * e.g., "src" → "lib" → "utils" becomes "src/lib/utils" if each has one child.
 */
export function compactSingleChildDirs(nodes: FileTreeNode[]): FileTreeNode[] {
	return nodes.map((node) => {
		if (!node.isDirectory) return node;

		let current = node;
		let compactedName = current.name;

		while (
			current.isDirectory &&
			current.children.length === 1 &&
			current.children[0].isDirectory
		) {
			current = current.children[0];
			compactedName = `${compactedName}/${current.name}`;
		}

		return {
			...current,
			name: compactedName,
			depth: node.depth,
			children: compactSingleChildDirs(current.children),
		};
	});
}
