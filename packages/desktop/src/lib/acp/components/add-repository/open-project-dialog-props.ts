/**
 * Which view is active in the unified Add Project dialog.
 */
export type AddProjectView = "import" | "clone";

/**
 * Props for the OpenProjectDialog component.
 */
export interface OpenProjectDialogProps {
	/** Whether the dialog is open */
	open: boolean;
	/** Callback when dialog open state changes */
	onOpenChange: (open: boolean) => void;
	/** Callback when a project is imported (added to database), receives the project path and name */
	onProjectImported: (path: string, name: string) => void;
	/** Callback when a clone completes, receives the project path and name */
	onCloneComplete: (path: string, name: string) => void;
	/** Callback to browse for a folder (native file dialog) */
	onBrowseFolder: () => void;
}

/**
 * Represents a project with session counts per agent.
 */
export interface ProjectWithSessions {
	/** Absolute path to the project */
	path: string;
	/** Display name of the project */
	name: string;
	/** Session counts per agent ID - number or "loading" while fetching or "error" on failure */
	agentCounts: Map<string, number | "loading" | "error">;
	/** Total number of sessions - number or "loading" while fetching or "error" on failure */
	totalSessions: number | "loading" | "error";
}
