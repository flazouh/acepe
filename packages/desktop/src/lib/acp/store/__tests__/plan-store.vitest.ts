import type { ResultAsync } from "neverthrow";
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanData, SessionPlanResponse } from "../../../services/converted-session-types.js";

import { AgentError, type AppError } from "../../errors/app-error.js";

type GetUnifiedPlan = (
	sessionId: string,
	projectPath: string,
	agentId: string
) => ResultAsync<SessionPlanResponse | null, AppError>;

const getUnifiedPlanMock = vi.fn<GetUnifiedPlan>();

vi.mock("../../../utils/tauri-client.js", () => ({
	tauriClient: {
		history: {
			getUnifiedPlan: getUnifiedPlanMock,
		},
	},
}));

vi.mock("../../utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import { PlanStore } from "../plan-store.svelte.js";

const samplePlan: SessionPlanResponse = {
	slug: "test-plan",
	content: "# Test Plan\n\n- Step 1",
	title: "Test Plan",
	summary: "Summary",
	filePath: "/tmp/test.plan.md",
};

describe("PlanStore", () => {
	beforeEach(() => {
		getUnifiedPlanMock.mockReset();
	});

	describe("updateFromEvent (streaming)", () => {
		it("updates from streaming plan event", () => {
			const store = new PlanStore();

			const planData: PlanData = {
				steps: [],
				streaming: true,
				content: "# My Plan",
				filePath: "/path/test.md",
				title: "My Plan",
			};

			store.updateFromEvent("session-1", planData);

			expect(store.isStreaming("session-1")).toBe(true);
			expect(store.getPlan("session-1")?.content).toBe("# My Plan");
			expect(store.getPlan("session-1")?.title).toBe("My Plan");
		});

		it("finalizes streaming when streaming: false", () => {
			const store = new PlanStore();

			// Start streaming
			store.updateFromEvent("session-1", {
				steps: [],
				streaming: true,
				content: "partial",
			});
			expect(store.isStreaming("session-1")).toBe(true);

			// Finalize
			store.updateFromEvent("session-1", {
				steps: [],
				streaming: false,
				content: "complete",
				filePath: "/final/path.md",
				title: "Complete Plan",
			});

			expect(store.isStreaming("session-1")).toBe(false);
			expect(store.getPlan("session-1")?.content).toBe("complete");
			expect(store.getPlan("session-1")?.title).toBe("Complete Plan");
		});

		it("ignores events without content", () => {
			const store = new PlanStore();

			// Event with no content should be ignored
			store.updateFromEvent("session-1", {
				steps: [],
				streaming: true,
			});

			expect(store.getPlan("session-1")).toBeUndefined();
		});

		it("accumulates content updates", () => {
			const store = new PlanStore();

			store.updateFromEvent("session-1", {
				steps: [],
				streaming: true,
				content: "# Plan\n",
			});

			store.updateFromEvent("session-1", {
				steps: [],
				streaming: true,
				content: "# Plan\n\n- Step 1",
			});

			store.updateFromEvent("session-1", {
				steps: [],
				streaming: true,
				content: "# Plan\n\n- Step 1\n- Step 2",
			});

			expect(store.getPlan("session-1")?.content).toBe("# Plan\n\n- Step 1\n- Step 2");
		});

		it("builds markdown from steps when content is absent", () => {
			const store = new PlanStore();

			store.updateFromEvent("session-1", {
				steps: [
					{ description: "Step one", status: "pending" },
					{ description: "Step two", status: "in_progress" },
				],
				streaming: true,
				hasPlan: true,
			});

			const content = store.getPlan("session-1")?.content ?? "";
			expect(content).toContain("# Plan");
			expect(content).toContain("Step one");
			expect(content).toContain("Step two");
		});

		it("keeps deterministic plan over later heuristic update", () => {
			const store = new PlanStore();

			store.updateFromEvent("session-1", {
				steps: [],
				streaming: false,
				content: "deterministic",
				source: "deterministic",
				confidence: "high",
				hasPlan: true,
			});

			store.updateFromEvent("session-1", {
				steps: [],
				streaming: false,
				content: "heuristic",
				source: "heuristic",
				confidence: "medium",
				hasPlan: true,
			});

			expect(store.getPlan("session-1")?.content).toBe("deterministic");
		});

		it("does not auto-open for heuristic steps-only plan updates", () => {
			const store = new PlanStore();

			store.updateFromEvent("session-1", {
				steps: [{ description: "Run typecheck", status: "pending" }],
				streaming: false,
				source: "heuristic",
				confidence: "medium",
			});

			expect(store.shouldAutoOpen("session-1", false)).toBe(false);
		});
	});

	describe("loadPlan (disk fallback)", () => {
		it("loads plan from disk for historical sessions", async () => {
			getUnifiedPlanMock.mockReturnValue(okAsync(samplePlan));

			const store = new PlanStore();
			store.loadPlan("session-1", "/project", "agent");

			// Wait for async operation
			await vi.waitFor(() => {
				expect(store.getPlan("session-1")).toEqual(samplePlan);
			});
		});

		it("skips disk load if streaming content exists", () => {
			const store = new PlanStore();

			// First, add streaming content
			store.updateFromEvent("session-1", {
				steps: [],
				streaming: true,
				content: "# Streaming",
			});

			// Try to load from disk - should be skipped
			store.loadPlan("session-1", "/project", "agent");

			// getUnifiedPlan should not have been called
			expect(getUnifiedPlanMock).not.toHaveBeenCalled();

			// Content should still be the streaming content
			expect(store.getPlan("session-1")?.content).toBe("# Streaming");
		});

		it("handles disk load errors gracefully", async () => {
			getUnifiedPlanMock.mockReturnValue(
				errAsync(new AgentError("getUnifiedPlan", new Error("Network error")))
			);

			const store = new PlanStore();
			store.loadPlan("session-1", "/project", "agent");

			// Wait for async operation
			await vi.waitFor(() => {
				expect(store.getPlan("session-1")).toBeNull();
			});
		});
	});

	describe("clear", () => {
		it("clears both streaming and disk plans", () => {
			const store = new PlanStore();

			// Add streaming content
			store.updateFromEvent("session-1", {
				steps: [],
				streaming: false,
				content: "# Complete",
			});

			expect(store.getPlan("session-1")).toBeDefined();

			store.clear("session-1");

			expect(store.getPlan("session-1")).toBeUndefined();
		});
	});

	describe("isStreaming", () => {
		it("returns false for unknown sessions", () => {
			const store = new PlanStore();
			expect(store.isStreaming("unknown")).toBe(false);
		});

		it("returns true while streaming", () => {
			const store = new PlanStore();

			store.updateFromEvent("session-1", {
				steps: [],
				streaming: true,
				content: "partial",
			});

			expect(store.isStreaming("session-1")).toBe(true);
		});

		it("returns false after streaming completes", () => {
			const store = new PlanStore();

			store.updateFromEvent("session-1", {
				steps: [],
				streaming: true,
				content: "partial",
			});
			store.updateFromEvent("session-1", {
				steps: [],
				streaming: false,
				content: "complete",
			});

			expect(store.isStreaming("session-1")).toBe(false);
		});
	});
});
