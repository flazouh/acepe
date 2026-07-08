import type { ReviewWorkspaceFileItem } from "@acepe/ui/agent-panel";

export const reviewWorkspaceSectionMeta = {
	title: "Review workspace",
	description:
		"Full review modal surface with the Pierre file tree rail, compact density, review state, and diff counts.",
};

export const reviewWorkspaceSpecimenFiles: readonly ReviewWorkspaceFileItem[] = [
	{
		id: "review-file-list",
		filePath: "packages/ui/src/components/agent-panel/review-workspace-file-list.svelte",
		fileName: "review-workspace-file-list.svelte",
		reviewStatus: "reviewed",
		additions: 42,
		deletions: 18,
	},
	{
		id: "review-tree-model",
		filePath: "packages/ui/src/components/agent-panel/review-workspace-tree-model.ts",
		fileName: "review-workspace-tree-model.ts",
		reviewStatus: "unreviewed",
		additions: 78,
		deletions: 0,
	},
	{
		id: "review-desktop-host",
		filePath: "packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-review-workspace.svelte",
		fileName: "agent-panel-review-workspace.svelte",
		reviewStatus: "unreviewed",
		additions: 16,
		deletions: 1,
	},
];
