/**
 * Tree node for UI rendering.
 */
export interface SkillTreeNode {
	/** Node identifier */
	id: string;
	/** Display label */
	label: string;
	/** Node type: "agent", "skill", "plugins-section", "plugin", or "plugin-skill" */
	nodeType: "agent" | "skill" | "plugins-section" | "plugin" | "plugin-skill";
	/** Agent ID (for agent/skill nodes) or Plugin ID (for plugin nodes) */
	agentId: string;
	/** Children nodes (for expandable nodes) */
	children: SkillTreeNode[];
	/** Whether this node is expandable */
	isExpandable: boolean;
}
