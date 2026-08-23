import { CommandId, EventId, ProjectId } from "@acepe/contracts";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { composeSetupBarStore, isSetupBarEvent } from "./setup-bar-store.ts";

describe("isSetupBarEvent", () => {
	it("accepts skills, mcp, and preconnection events", () => {
		expect(
			isSetupBarEvent({
				sequence: 1,
				eventId: EventId.make("event-1"),
				aggregateKind: "mcp",
				aggregateId: ProjectId.make("library-project-1"),
				occurredAt: "2026-08-20T12:00:00.000Z",
				commandId: CommandId.make("cmd-1"),
				causationEventId: null,
				correlationId: CommandId.make("cmd-1"),
				metadata: {},
				type: "McpCatalogResolved",
				payload: {
					projectId: ProjectId.make("library-project-1"),
					catalog: {
						source: "preconnectionConfig",
						servers: [],
					},
				},
			}),
		).toBe(true);
		expect(
			isSetupBarEvent({
				sequence: 1,
				eventId: EventId.make("event-1"),
				aggregateKind: "project",
				aggregateId: ProjectId.make("library-project-1"),
				occurredAt: "2026-08-20T12:00:00.000Z",
				commandId: CommandId.make("cmd-1"),
				causationEventId: null,
				correlationId: CommandId.make("cmd-1"),
				metadata: {},
				type: "ProjectCreated",
				payload: {
					projectId: ProjectId.make("library-project-1"),
					title: "Acepe",
					workspaceRoot: "/tmp/acepe",
				},
			}),
		).toBe(false);
	});
});

describe("composeSetupBarStore", () => {
	it("dispatches discover, catalog resolve, and options load then snapshots", async () => {
		const dispatched: Array<string> = [];
		const registry = AtomRegistry.make();
		const store = composeSetupBarStore({
			client: {
				dispatch: (command) => {
					dispatched.push(command.type);
					return Effect.succeed({ sequence: 1 });
				},
				snapshot: (request) => {
					const kind = "kind" in request ? request.kind : null;
					return Effect.succeed({
						snapshotSequence: 1,
						session: null,
						messages: [],
						turns: [],
						activities: [],
						pendingApprovals: [],
						checkpoints: [],
						projects: [],
						sessions: [],
						settings: [],
						skillsCatalog:
							kind === "skills"
								? {
										sequence: 1,
										agents: [],
										agentSkills: [],
										plugins: [],
										pluginSkills: [],
										tree: [],
									}
								: null,
						voice: null,
						gitReview: null,
						mcpCatalog:
							kind === "mcp"
								? {
										sequence: 1,
										projectId: ProjectId.make("library-project-1"),
										catalog: {
											source: "preconnectionConfig",
											servers: [],
										},
									}
								: null,
						preconnectionOptions:
							kind === "mcp"
								? {
										sequence: 1,
										projectId: ProjectId.make("library-project-1"),
										providerId: "claude-code",
										options: [],
									}
								: null,
					});
				},
				events: () => Stream.empty,
				getProjectIndex: () =>
					Effect.succeed({
						projectPath: "/tmp/acepe",
						files: [],
						gitStatus: [],
						totalFiles: 0,
						totalLines: 0,
					}),
				invalidateProjectIndex: () => Effect.void,
			},
			registry,
		});
		await Effect.runPromise(store.openSetupBar());
		expect(dispatched).toEqual([
			"skills.discover",
			"mcp.catalog.resolve",
			"preconnection.options.load",
		]);
	});
});
