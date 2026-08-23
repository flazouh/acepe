import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	ProjectId,
	type RpcClient,
	type RpcSessionSnapshot,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { UI } from "../../acp/constants/ui.js";
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

const projected = {
	projectId,
	title: "Acepe",
	workspaceRoot: "/repo/acepe",
	createdAt: "2026-08-23T09:00:00.000Z",
	updatedAt: "2026-08-23T10:00:00.000Z",
	deletedAt: null,
	sessionCount: 2,
	gitStatus: [],
};

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
						color: UI.DEFAULT_PROJECT_COLOR,
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

	it("fails color updates that are not on the contract", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(
					projects.updateProjectColor("/repo/acepe", "#fff")
				);
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
