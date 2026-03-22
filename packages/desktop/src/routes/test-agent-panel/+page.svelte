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
	],
	entryCount: 2,
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
			selectedAgentId="claude-code"
			availableAgents={[{ id: "claude-code", name: "Claude Code", icon: "", available: true, availability_kind: { kind: "bundled" as const } }]}
			onAgentChange={async () => {}}
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
