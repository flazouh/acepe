<script lang="ts">
import type { Session } from "$lib/acp/application/dto/session";
import AgentPanel from "$lib/acp/components/agent-panel/components/agent-panel.svelte";
import type { Project } from "$lib/acp/logic/project-manager.svelte";

// Mock session data
const mockSession: Session = {
	id: "test-session-1",
	projectPath: "/Users/test/project",
	agentId: "claude-code",
	title: "Test Session",
	status: "idle",
	entries: [
		{
			id: "entry-1",
			type: "user",
			timestamp: new Date(),
			message: {
				content: {
					type: "text",
					text: "Hello, this is a test message!",
				},
				chunks: [
					{
						type: "text",
						text: "Hello, this is a test message!",
					},
				],
			},
		},
		{
			id: "entry-2",
			type: "assistant",
			timestamp: new Date(),
			message: {
				chunks: [
					{
						type: "message",
						block: {
							type: "text",
							text: "Hello! I'm here to help you test the agent panel component.",
						},
					},
				],
			},
		},
		{
			id: "entry-2b",
			type: "assistant",
			timestamp: new Date(),
			message: {
				chunks: [
					{
						type: "message",
						block: {
							type: "text",
							text: `Here's an example of a Go program:

\`\`\`go
package main

import "fmt"

func main() {
    message := "Hello, World!"
    fmt.Println(message)
}
\`\`\`

This code demonstrates a simple Go program that prints a message.`,
						},
					},
				],
			},
		},
		{
			id: "entry-2c",
			type: "assistant",
			timestamp: new Date(),
			message: {
				chunks: [
					{
						type: "message",
						block: {
							type: "text",
							text: `# Markdown Examples

This message demonstrates various markdown features:

## Lists

### Unordered List
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

### Ordered List
1. First numbered item
2. Second numbered item
3. Third numbered item

## Table

| Feature | Status | Priority |
|---------|--------|----------|
| Code blocks | ✅ Done | High |
| Tables | ✅ Done | High |
| Lists | ✅ Done | Medium |
| Headings | ✅ Done | Medium |
| Links | ✅ Done | Low |

## Code Examples

Here's some \`inline code\` and a code block:

\`\`\`typescript
interface User {
  id: string;
  name: string;
  email: string;
}

function greetUser(user: User): string {
  return \`Hello, \${user.name}!\`;
}
\`\`\`

## Text Formatting

This text has **bold**, *italic*, and ***bold italic*** formatting.

> This is a blockquote. It can contain multiple lines
> and is useful for highlighting important information.

## Links

Check out [TypeScript](https://www.typescriptlang.org/) and [Svelte](https://svelte.dev/) for more information.

---

That's all for now!`,
						},
					},
				],
			},
		},
		{
			id: "entry-3",
			type: "tool_call",
			timestamp: new Date(),
			message: {
				id: "tool-call-1",
				name: "Edit",
				status: "completed",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/Users/test/project/src/example.ts",
							oldString: "function hello() {\n  console.log('Hello');\n}",
							newString: "function hello() {\n  console.log('Hello, World!');\n}",
						},
					],
				},
				result: null,
				kind: "edit",
				title: "Edit",
				awaitingPlanApproval: false,
			},
		},
	],
	entryCount: 5,
	taskProgress: null,
	isConnected: false,
	isStreaming: false,
	availableModels: [{ id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" }],
	availableModes: [
		{ id: "auto", name: "Auto" },
		{ id: "code", name: "Code" },
	],
	availableCommands: [],
	currentModel: { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
	currentMode: { id: "auto", name: "Auto" },
	createdAt: new Date(),
	updatedAt: new Date(),
	acpSessionId: null,
	parentId: null,
};

// Mock project
const mockProject: Project = {
	path: "/Users/test/project",
	name: "Test Project",
	lastOpened: new Date(),
	createdAt: new Date(),
	color: "#3b82f6",
};

// State
let sessionId: string | null = $state(mockSession.id);
let isFullscreen = $state(false);
let isFocused = $state(true);
let width = $state(600);

// Compute project from mock session
const project = $derived.by(() => {
	return sessionId
		? ([mockProject].find((p) => p.path === mockSession.projectPath) ?? null)
		: mockProject;
});

// Event handlers
function handleClose() {
	console.log("Panel closed");
}

function handleCreateSessionForProject(project: Project) {
	console.log("Create session for project:", project);
}

function handleSessionCreated(sessionId: string) {
	console.log("Session created:", sessionId);
}

function handleResizePanel(panelId: string, delta: number) {
	console.log("Resize panel:", panelId, delta);
	width = Math.max(400, Math.min(1200, width + delta));
}

function handleToggleFullscreen() {
	isFullscreen = !isFullscreen;
	console.log("Fullscreen toggled:", isFullscreen);
}

function handleFocus() {
	isFocused = true;
	console.log("Panel focused");
}

// Hoisted available agents array (stable reference)
const availableAgents = [
	{
		id: "claude-code",
		name: "Claude Code",
		icon: "",
		availability_kind: { kind: "installable" as const, installed: true },
	},
];

// Local reactive state for selected agent
let selectedAgentId = $state("claude-code");

// Real onAgentChange handler that updates local state
async function handleAgentChange(agentId: string) {
	selectedAgentId = agentId;
	console.log("Agent changed to:", agentId);
}
</script>

<div class="h-screen w-screen p-4 bg-background">
	<div class="h-full w-full">
		<AgentPanel
			panelId="test-panel-1"
			{sessionId}
			{width}
			pendingProjectSelection={false}
			projectCount={1}
			allProjects={[mockProject]}
			{project}
			{selectedAgentId}
			{availableAgents}
			onAgentChange={handleAgentChange}
			effectiveTheme="dark"
			onClose={handleClose}
			onCreateSessionForProject={handleCreateSessionForProject}
			onSessionCreated={handleSessionCreated}
			onResizePanel={handleResizePanel}
			onToggleFullscreen={handleToggleFullscreen}
			{isFullscreen}
			{isFocused}
			onFocus={handleFocus}
		/>
	</div>
</div>
