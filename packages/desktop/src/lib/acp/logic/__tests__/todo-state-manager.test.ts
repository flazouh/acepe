import { beforeEach, describe, expect, it } from "vitest";

import type { StoredEntry, StoredThread } from "../../infrastructure/storage/ThreadStorage.js";

import { computeTodoSignature, getTodoStateManager } from "../todo-state-manager.svelte.js";

describe("TodoStateManager", () => {
	let manager: ReturnType<typeof getTodoStateManager>;

	beforeEach(() => {
		manager = getTodoStateManager();
		manager.clearCache();
	});

	describe("Signature Computation", () => {
		it("should compute empty signature for no TodoWrite entries", () => {
			const entries: StoredEntry[] = [
				{
					id: "1",
					type: "user",
					message: {
						content: { type: "text" as const, text: "test" },
						chunks: [{ type: "text" as const, text: "test" }],
					},
					timestamp: new Date(),
				},
			];

			const signature = computeTodoSignature(entries);
			expect(signature).toBe("empty");
		});

		it("should compute signature from TodoWrite entries", () => {
			const timestamp = new Date("2025-01-01T00:00:00Z");
			const entries: StoredEntry[] = [
				{
					id: "1",
					type: "tool_call",
					message: {
						id: "todo-1",
						name: "TodoWrite",
						status: "completed",
						arguments: { kind: "think" },
						normalizedTodos: [{ content: "Task 1", activeForm: "Task 1", status: "pending" }],
					},
					timestamp,
				},
			];

			const signature = computeTodoSignature(entries);
			// Signature uses only entry IDs for stability (not timestamps)
			expect(signature).toBe("1");
		});

		it("should create different signatures for different TodoWrites", () => {
			const time1 = new Date("2025-01-01T00:00:00Z");
			const time2 = new Date("2025-01-01T00:01:00Z");

			const entries1: StoredEntry[] = [
				{
					id: "1",
					type: "tool_call",
					message: {
						id: "todo-1",
						name: "TodoWrite",
						status: "completed",
						arguments: { kind: "think" },
						normalizedTodos: [{ content: "Task 1", activeForm: "Task 1", status: "pending" }],
					},
					timestamp: time1,
				},
			];

			const entries2: StoredEntry[] = [
				...entries1,
				{
					id: "2",
					type: "tool_call",
					message: {
						id: "todo-2",
						name: "TodoWrite",
						status: "completed",
						arguments: { kind: "think" },
						normalizedTodos: [{ content: "Task 2", activeForm: "Task 2", status: "pending" }],
					},
					timestamp: time2,
				},
			];

			const sig1 = computeTodoSignature(entries1);
			const sig2 = computeTodoSignature(entries2);

			expect(sig1).not.toBe(sig2);
			expect(sig2).toContain(sig1); // sig2 should include sig1 plus new entry
		});
	});

	describe("Cache Behavior", () => {
		it("should return null for null thread", () => {
			const result = manager.getTodoState("thread-1", null);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(null);
		});

		it("should return null for thread with no TodoWrites", () => {
			const thread: StoredThread = {
				id: "thread-1",
				source: "active",
				title: "Test",
				entries: [
					{
						id: "1",
						type: "user",
						message: {
							content: { type: "text" as const, text: "test" },
							chunks: [{ type: "text" as const, text: "test" }],
						},
						timestamp: new Date(),
					},
				],
				status: "idle",
				agentId: "test-agent",
				projectPath: "/test",
				projectName: "Test",
				plan: null,
				connection: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const result = manager.getTodoState("thread-1", thread);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(null);
		});

		it("should cache computed state", () => {
			const thread: StoredThread = {
				id: "thread-1",
				source: "active",
				title: "Test",
				entries: [
					{
						id: "1",
						type: "tool_call",
						message: {
							id: "todo-1",
							name: "TodoWrite",
							status: "completed",
							arguments: { kind: "think" },
							normalizedTodos: [
								{
									content: "Task 1",
									status: "pending",
									activeForm: "Working on Task 1",
								},
							],
						},
						timestamp: new Date(),
					},
				],
				status: "idle",
				agentId: "test-agent",
				projectPath: "/test",
				projectName: "Test",
				plan: null,
				connection: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			// First call - cache miss
			const metrics1 = manager.getMetrics();
			const result1 = manager.getTodoState("thread-1", thread);

			const metrics2 = manager.getMetrics();
			expect(metrics2.cacheMisses).toBe(metrics1.cacheMisses + 1);
			expect(result1.isOk()).toBe(true);

			// Second call with same thread - cache hit
			const result2 = manager.getTodoState("thread-1", thread);

			const metrics3 = manager.getMetrics();
			expect(metrics3.cacheHits).toBe(metrics2.cacheHits + 1);
			expect(result2.isOk()).toBe(true);

			// Results should be identical
			expect(result1._unsafeUnwrap()).toEqual(result2._unsafeUnwrap());
		});

		it("should invalidate cache when signature changes", () => {
			const baseThread: StoredThread = {
				id: "thread-1",
				source: "active",
				title: "Test",
				entries: [
					{
						id: "1",
						type: "tool_call",
						message: {
							id: "todo-1",
							name: "TodoWrite",
							status: "completed",
							arguments: { kind: "think" },
							normalizedTodos: [
								{
									content: "Task 1",
									status: "pending",
									activeForm: "Working on Task 1",
								},
							],
						},
						timestamp: new Date(),
					},
				],
				status: "idle",
				agentId: "test-agent",
				projectPath: "/test",
				projectName: "Test",
				plan: null,
				connection: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			// First call
			const result1 = manager.getTodoState("thread-1", baseThread);
			const metrics1 = manager.getMetrics();

			// Update thread with new TodoWrite
			const updatedThread: StoredThread = {
				...baseThread,
				entries: [
					...baseThread.entries,
					{
						id: "2",
						type: "tool_call",
						message: {
							id: "todo-2",
							name: "TodoWrite",
							status: "completed",
							arguments: { kind: "think" },
							normalizedTodos: [
								{
									content: "Task 1",
									status: "completed",
									activeForm: "Working on Task 1",
								},
							],
						},
						timestamp: new Date(),
					},
				],
			};

			// Second call with updated thread - should be cache miss
			const result2 = manager.getTodoState("thread-1", updatedThread);
			const metrics2 = manager.getMetrics();

			expect(metrics2.cacheMisses).toBe(metrics1.cacheMisses + 1);
			expect(result1._unsafeUnwrap()).not.toEqual(result2._unsafeUnwrap());
		});
	});

	describe("Performance Metrics", () => {
		it("should track cache hits and misses", () => {
			const thread: StoredThread = {
				id: "thread-metrics-1",
				source: "active",
				title: "Test",
				entries: [
					{
						id: "metrics-1",
						type: "tool_call",
						message: {
							id: "todo-metrics-1",
							name: "TodoWrite",
							status: "completed",
							arguments: { kind: "think" },
							normalizedTodos: [
								{
									content: "Task 1",
									status: "pending",
									activeForm: "Working on Task 1",
								},
							],
						},
						timestamp: new Date(),
					},
				],
				status: "idle",
				agentId: "test-agent",
				projectPath: "/test",
				projectName: "Test",
				plan: null,
				connection: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			manager.clearCache();
			const metricsStart = manager.getMetrics();

			// Cache miss
			manager.getTodoState("thread-metrics-1", thread);

			// Cache hit
			manager.getTodoState("thread-metrics-1", thread);

			// Cache hit
			manager.getTodoState("thread-metrics-1", thread);

			const metricsEnd = manager.getMetrics();

			// Check differences from baseline
			expect(metricsEnd.cacheMisses - metricsStart.cacheMisses).toBe(1);
			expect(metricsEnd.cacheHits - metricsStart.cacheHits).toBe(2);
		});

		it("should track computation time", () => {
			const thread: StoredThread = {
				id: "thread-metrics-2",
				source: "active",
				title: "Test",
				entries: [
					{
						id: "metrics-2",
						type: "tool_call",
						message: {
							id: "todo-metrics-2",
							name: "TodoWrite",
							status: "completed",
							arguments: { kind: "think" },
							normalizedTodos: [
								{
									content: "Task 1",
									status: "pending",
									activeForm: "Working on Task 1",
								},
							],
						},
						timestamp: new Date(),
					},
				],
				status: "idle",
				agentId: "test-agent",
				projectPath: "/test",
				projectName: "Test",
				plan: null,
				connection: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			manager.clearCache();
			const metricsStart = manager.getMetrics();

			manager.getTodoState("thread-metrics-2", thread);

			const metricsEnd = manager.getMetrics();

			expect(metricsEnd.totalComputations - metricsStart.totalComputations).toBe(1);
			expect(metricsEnd.averageComputationTime).toBeGreaterThan(0);
		});
	});

	describe("Cache Invalidation", () => {
		it("should invalidate all cache entries for a thread", () => {
			const thread: StoredThread = {
				id: "thread-1",
				source: "active",
				title: "Test",
				entries: [
					{
						id: "1",
						type: "tool_call",
						message: {
							id: "todo-1",
							name: "TodoWrite",
							status: "completed",
							arguments: { kind: "think" },
							normalizedTodos: [
								{
									content: "Task 1",
									status: "pending",
									activeForm: "Working on Task 1",
								},
							],
						},
						timestamp: new Date(),
					},
				],
				status: "idle",
				agentId: "test-agent",
				projectPath: "/test",
				projectName: "Test",
				plan: null,
				connection: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			// Populate cache
			manager.getTodoState("thread-1", thread);

			const metrics1 = manager.getMetrics();
			expect(metrics1.cacheSize).toBeGreaterThan(0);

			// Invalidate
			manager.invalidateThread("thread-1");

			// Next call should be cache miss
			manager.getTodoState("thread-1", thread);

			const metrics2 = manager.getMetrics();
			expect(metrics2.cacheMisses).toBe(metrics1.cacheMisses + 1);
		});
	});
});
