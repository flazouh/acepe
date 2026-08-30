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
import { projects, rankProjectsForOrder } from "./projects.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	showExternalCliSessions: false,
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
	showExternalCliSessions: false,
	sortOrder: null,
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

const rowAt = (
	id: string,
	workspaceRoot: string,
	sortOrder: number | null
): RpcProjectedProject => ({
	...projected,
	projectId: ProjectId.make(id),
	title: workspaceRoot,
	workspaceRoot,
	sortOrder,
});

const sortOrderCommands = (
	commands: readonly OrchestrationCommand[]
): { projectId: string; sortOrder: number | undefined }[] => {
	const written: { projectId: string; sortOrder: number | undefined }[] = [];
	for (const command of commands) {
		if (command.type === "project.meta.update") {
			written.push({ projectId: command.projectId, sortOrder: command.sortOrder });
		}
	}
	return written;
};

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
						// Straight off the projection: the facade never invents a rank.
						sort_order: null,
						// Carried through so the sidebar checkbox can show the stored
						// value instead of guessing a default the server disagrees with.
						show_external_cli_sessions: false,
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

	it("writes a dense rank per moved project through project.meta.update", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: OrchestrationCommand[] = [];
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed(
								withProjects(emptyRpcSessionSnapshot(0), [
									rowAt("project-a", "/repo/a", 0),
									rowAt("project-b", "/repo/b", 1),
									rowAt("project-c", "/repo/c", 2),
								])
							),
						dispatch: (command) => {
							dispatched.push(command);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				const updated = yield* projects.updateProjectOrder(["/repo/a", "/repo/c", "/repo/b"]);
				// Only the two that swapped move, so only those two are written.
				expect(sortOrderCommands(dispatched)).toEqual([
					{ projectId: "project-c", sortOrder: 1 },
					{ projectId: "project-b", sortOrder: 2 },
				]);
				expect(updated.map((project) => [project.path, project.sort_order])).toEqual([
					["/repo/a", 0],
					["/repo/c", 1],
					["/repo/b", 2],
				]);
			})
		));

	it("ranks every project on the first move, when none of them has a rank yet", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: OrchestrationCommand[] = [];
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed(
								withProjects(emptyRpcSessionSnapshot(0), [
									rowAt("project-a", "/repo/a", null),
									rowAt("project-b", "/repo/b", null),
								])
							),
						dispatch: (command) => {
							dispatched.push(command);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* projects.updateProjectOrder(["/repo/b", "/repo/a"]);
				expect(sortOrderCommands(dispatched)).toEqual([
					{ projectId: "project-b", sortOrder: 0 },
					{ projectId: "project-a", sortOrder: 1 },
				]);
			})
		));

	it("writes the external-session visibility through project.meta.update", () =>
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
				yield* projects.updateProjectShowExternalCliSessions("/repo/acepe", true);
				expect(dispatched).toHaveLength(1);
				const command = dispatched[0];
				expect(command?.type).toBe("project.meta.update");
				expect(
					command?.type === "project.meta.update" ? command.showExternalCliSessions : null
				).toBe(true);
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
