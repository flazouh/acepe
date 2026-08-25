import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	type OrchestrationCommand,
	type ProjectColor,
	ProjectId,
	type RpcClient,
	type RpcProjectedProject,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { projects } from "./projects.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const projectId = ProjectId.make("project-1");

const projectedWithColor = (color: ProjectColor): RpcProjectedProject => ({
	projectId,
	title: "Acepe",
	workspaceRoot: "/repo/acepe",
	createdAt: "2026-08-23T09:00:00.000Z",
	updatedAt: "2026-08-23T10:00:00.000Z",
	deletedAt: null,
	sessionCount: 2,
	color,
	gitStatus: [],
});

const projected = projectedWithColor("indigo");

const withProjects = (
	snapshot: RpcSessionSnapshot,
	rows: RpcSessionSnapshot["projects"]
): RpcSessionSnapshot => ({
	...snapshot,
	projects: rows,
});

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(withProjects(emptyRpcSessionSnapshot(0), [projected])),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
	agentCall: () => Effect.succeed({ op: "agent.list" as const, agents: [] }),
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () =>
		Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("projects rpc facade", () => {
	it("maps library snapshot projects onto ProjectData", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const listed = yield* projects.getProjects();
				expect(listed).toEqual([
					{
						path: "/repo/acepe",
						name: "Acepe",
						last_opened: "2026-08-23T10:00:00.000Z",
						created_at: "2026-08-23T09:00:00.000Z",
						color: "indigo",
						sort_order: 0,
						icon_path: null,
					},
				]);
			})
		));

	it("imports a project through project.create", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: string[] = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command.type);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				const imported = yield* projects.importProject("/repo/acepe", "Acepe");
				expect(dispatched).toEqual(["project.create"]);
				expect(imported.path).toBe("/repo/acepe");
				expect(imported.name).toBe("Acepe");
			})
		));

	it("deletes a project through project.delete", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: string[] = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command.type);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* projects.removeProject("/repo/acepe");
				expect(dispatched).toEqual(["project.delete"]);
			})
		));

	it("writes a picked color through project.meta.update", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: OrchestrationCommand[] = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* projects.updateProjectColor("/repo/acepe", "pink");
				expect(dispatched).toHaveLength(1);
				const command = dispatched[0];
				expect(command?.type).toBe("project.meta.update");
				expect(command?.type === "project.meta.update" ? command.color : null).toBe("pink");
			})
		));

	// The projection catches up on its own fiber, so re-reading the snapshot
	// here would hand back the pre-update color and revert the pick.
	it("answers with the picked color even when the snapshot still has the old one", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed(
								withProjects(emptyRpcSessionSnapshot(0), [projectedWithColor("indigo")])
							),
					})
				);
				const updated = yield* projects.updateProjectColor("/repo/acepe", "pink");
				expect(updated.color).toBe("pink");
				expect(updated.path).toBe("/repo/acepe");
				expect(updated.name).toBe("Acepe");
			})
		));

	it("rejects a color name that is not in the palette", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(projects.updateProjectColor("/repo/acepe", "#fff"));
				expect(Result.isFailure(result)).toBe(true);
			})
		));

	it("fails a color update for a path the library does not know", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(projects.updateProjectColor("/repo/other", "pink"));
				expect(Result.isFailure(result)).toBe(true);
			})
		));

	it("returns an empty missing-path list because filesystem checks are not on the contract", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const missing = yield* projects.getMissingProjectPaths(["/repo/acepe"]);
				expect(missing).toEqual([]);
			})
		));
});
