import { Colors } from "@acepe/ui/colors";
import type { HugeiconsIconName } from "@acepe/ui/icons";

export interface BranchPrefix {
	readonly label: string;
	readonly value: string;
	readonly iconName: HugeiconsIconName;
	readonly color: string;
}

export const BRANCH_PREFIXES: readonly BranchPrefix[] = [
	{ label: "None", value: "", iconName: "branch", color: Colors.purple },
	{ label: "feat", value: "feat/", iconName: "sparkle", color: "var(--success)" },
	{ label: "fix", value: "fix/", iconName: "bug", color: Colors.red },
	{ label: "chore", value: "chore/", iconName: "wrench", color: Colors.orange },
	{ label: "refactor", value: "refactor/", iconName: "recycle", color: Colors.cyan },
	{ label: "docs", value: "docs/", iconName: "notebook", color: Colors.yellow },
	{ label: "test", value: "test/", iconName: "flask", color: Colors.pink },
];

export const DEFAULT_BRANCH_PREFIX = BRANCH_PREFIXES[0];
