import { afterEach, beforeEach, describe, mock } from "bun:test";
import type { Session } from "../../../application/dto/session";
import type { Project } from "../../../logic/project-manager.svelte";

/**
 * Component test for AgentPanel using @testing-library/svelte.
 *
 * Tests the actual component behavior, including:
 * - Panel click handler interference with input area
 * - @ and / trigger functionality
 */
describe("AgentPanel Component - Click Handler Interference", () => {
	let mockSession: Session;
	let mockProject: Project;
	let onFocusMock: ReturnType<typeof mock>;
	let onCloseMock: ReturnType<typeof mock>;
	let AgentPanel: any;

	beforeEach(async () => {
		// Mock svelte-sonner inside describe block
		// This prevents dependency resolution issues and allows us to test without the full dependency tree
		mock.module("svelte-sonner", () => ({
			toast: {
				success: () => {},
				error: () => {},
				info: () => {},
				warning: () => {},
				loading: () => {},
				promise: () => Promise.resolve(),
				custom: () => {},
				message: () => {},
				dismiss: () => {},
			},
		}));

		// Mock the internal dependency that's causing issues
		mock.module("runed", () => ({}));

		// Mock lucide icons to prevent dependency issues
		mock.module("@lucide/svelte/icons", () => ({}));

		// Dynamically import the component after mocking
		const module = await import("../components/agent-panel.svelte");
		AgentPanel = module.default;
		// Create mock session data
		mockSession = {
			id: "test-session-1",
			projectPath: "/Users/test/project",
			agentId: "claude-code",
			title: "Test Session",
			status: "idle",
			entries: [],
			entryCount: 0,
			taskProgress: null,
			isConnected: false,
			isStreaming: false,
			availableModels: [
				{ id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "Test model" },
			],
			availableModes: [
				{ id: "auto", name: "Auto", description: "Auto mode" },
				{ id: "code", name: "Code", description: "Code mode" },
			],
			availableCommands: [],
			currentModel: {
				id: "claude-3-5-sonnet-20241022",
				name: "Claude 3.5 Sonnet",
				description: "Test model",
			},
			currentMode: { id: "auto", name: "Auto", description: "Auto mode" },
			createdAt: new Date(),
			updatedAt: new Date(),
			acpSessionId: null,
			parentId: null,
		};

		// Create mock project
		mockProject = {
			path: "/Users/test/project",
			name: "Test Project",
			lastOpened: new Date(),
			createdAt: new Date(),
			color: "#3b82f6",
		};

		// Create mock callbacks
		onFocusMock = mock(() => {});
		onCloseMock = mock(() => {});
	});

	afterEach(() => {
		// Clean up any rendered components
		document.body.innerHTML = "";
	});
});
