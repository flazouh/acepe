import type { AgentToolEntry } from "@acepe/ui";

export interface TaskToolSpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly taskDescription: string;
	readonly status: "running" | "done";
	readonly children: readonly AgentToolEntry[];
	readonly prompt?: string;
	readonly resultText?: string;
	readonly showDoneIcon?: boolean;
	readonly compact?: boolean;
}

export const taskToolSectionMeta = {
	title: "Subtask tool card",
	description:
		"Compact task header shown while a subagent runs. The task title stays on the left; the latest child tool renders as a verb label plus context (file badge, query, command, URL, etc.) on the right.",
};

function readChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-read",
		type: "tool_call",
		kind: "read",
		title: "Read",
		filePath: "/repo/packages/ui/src/components/agent-panel/agent-tool-task.svelte",
		status,
	};
}

function searchChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-search",
		type: "tool_call",
		kind: "search",
		title: "Search",
		query: "getTaskCurrentToolDisplay",
		status,
	};
}

function executeChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-execute",
		type: "tool_call",
		kind: "execute",
		title: "Run",
		command: "bun test src/components/agent-panel/agent-tool-compact-display-state.test.ts",
		status,
	};
}

function editChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-edit",
		type: "tool_call",
		kind: "edit",
		title: "Edit",
		status,
		editDiffs: [
			{
				filePath: "/repo/packages/ui/src/components/agent-panel/compact-tool-display.svelte",
				newString: "updated",
			},
		],
	};
}

function fetchChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-fetch",
		type: "tool_call",
		kind: "fetch",
		title: "Fetch",
		url: "https://example.com/docs/agent-panel",
		subtitle: "example.com",
		status,
	};
}

function webSearchChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-web-search",
		type: "tool_call",
		kind: "web_search",
		title: "Web search",
		query: "svelte 5 dialog scroll overflow",
		status,
	};
}

function skillChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-skill",
		type: "tool_call",
		kind: "skill",
		title: "Skill",
		skillName: "research",
		skillArgs: "topic=design-system",
		status,
	};
}

function readLintsChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-read-lints",
		type: "tool_call",
		kind: "read_lints",
		title: "Read lints",
		status,
		lintDiagnostics: [
			{
				filePath: "/repo/packages/ui/src/components/agent-panel/agent-tool-task.svelte",
				line: 12,
				message: "Unused import",
				severity: "warning",
			},
		],
	};
}

function browserChild(status: "running" | "done"): AgentToolEntry {
	return {
		id: "child-browser",
		type: "tool_call",
		kind: "browser",
		title: "Browser",
		subtitle: "Navigate to design system",
		status,
	};
}

function completedReadChild(): AgentToolEntry {
	return readChild("done");
}

function inProgressSearchChild(): AgentToolEntry {
	return searchChild("running");
}

export const taskToolSpecimens: readonly TaskToolSpecimen[] = [
	{
		id: "read-running",
		label: "Reading",
		caption: "Running · file badge",
		taskDescription: "Explore agent-tool-task rendering",
		status: "running",
		children: [readChild("running")],
	},
	{
		id: "search-running",
		label: "Grepping",
		caption: "Running · query subtitle",
		taskDescription: "Trace compact display mapping",
		status: "running",
		children: [searchChild("running")],
	},
	{
		id: "execute-running",
		label: "Executing",
		caption: "Running · file chip from command target",
		taskDescription: "Verify compact display tests",
		status: "running",
		children: [executeChild("running")],
	},
	{
		id: "edit-running",
		label: "Editing",
		caption: "Running · file badge from diff",
		taskDescription: "Update compact tool display layout",
		status: "running",
		children: [editChild("running")],
	},
	{
		id: "fetch-running",
		label: "Fetching",
		caption: "Running · domain subtitle",
		taskDescription: "Pull reference docs",
		status: "running",
		children: [fetchChild("running")],
	},
	{
		id: "web-search-running",
		label: "Searching",
		caption: "Running · web query subtitle",
		taskDescription: "Research dialog scroll patterns",
		status: "running",
		children: [webSearchChild("running")],
	},
	{
		id: "skill-running",
		label: "Running skill",
		caption: "Running · skill name and args",
		taskDescription: "Run research skill for UI patterns",
		status: "running",
		children: [skillChild("running")],
	},
	{
		id: "read-lints-running",
		label: "Checking lints",
		caption: "Running · lint summary subtitle",
		taskDescription: "Validate updated UI package files",
		status: "running",
		children: [readLintsChild("running")],
	},
	{
		id: "browser-running",
		label: "Browsing",
		caption: "Running · browser action subtitle",
		taskDescription: "Open design system in dev app",
		status: "running",
		children: [browserChild("running")],
	},
	{
		id: "progress-running",
		label: "Multi-step progress",
		caption: "Two child tools · segmented progress",
		taskDescription: "Investigate queue task item formatting",
		status: "running",
		children: [completedReadChild(), inProgressSearchChild()],
	},
	{
		id: "done-success",
		label: "Completed task",
		caption: "Done · success icon · read child complete",
		taskDescription: "Review the implementation",
		status: "done",
		showDoneIcon: true,
		resultText: "Reviewed compact display mapping and task header layout.",
		children: [readChild("done")],
	},
	{
		id: "compact-kanban",
		label: "Compact card",
		caption: "Kanban / queue density · executing child",
		taskDescription: "Trace queue item rendering",
		status: "running",
		compact: true,
		children: [executeChild("running")],
	},
];

export const featuredTaskToolSpecimen: TaskToolSpecimen = taskToolSpecimens[0];
