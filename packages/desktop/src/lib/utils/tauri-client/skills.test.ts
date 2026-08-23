import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	emptySkillsCatalog,
	type RpcClient,
	type RpcSessionSnapshot,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { AgentError } from "../../acp/errors/app-error.js";
import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { skills } from "./skills.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const catalogSnapshot = (): RpcSessionSnapshot => ({
	...emptyRpcSessionSnapshot(0),
	skillsCatalog: {
		sequence: 1,
		agents: [
			{
				id: "claude-code",
				name: "Claude Code",
				skillsDir: "/agents/claude/skills",
				exists: true,
			},
		],
		agentSkills: [
			{
				agentId: "claude-code",
				skills: [
					{
						id: "claude-code::review",
						agentId: "claude-code",
						folderName: "review",
						path: "/agents/claude/skills/review/SKILL.md",
						name: "Review",
						description: "Review code",
						content: "# Review",
						modifiedAt: 1,
					},
				],
			},
		],
		plugins: [],
		pluginSkills: [],
		tree: [
			{
				id: "agent-claude-code",
				label: "Claude Code",
				nodeType: "agent",
				agentId: "claude-code",
				children: [],
				isExpandable: true,
			},
		],
	},
});

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(catalogSnapshot()),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("skills rpc facade", () => {
	it("discovers then lists the skill tree from the snapshot", () =>
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
				const tree = yield* skills.listTree();
				expect(dispatched).toEqual(["skills.discover"]);
				expect(tree).toEqual([
					{
						id: "agent-claude-code",
						label: "Claude Code",
						nodeType: "agent",
						agentId: "claude-code",
						children: [],
						isExpandable: true,
					},
				]);
			})
		));

	it("returns a skill from the discovered catalog", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const skill = yield* skills.get("claude-code::review");
				expect(skill.id).toBe("claude-code::review");
				expect(skill.agentId).toBe("claude-code");
				expect(skill.modifiedAt).toBe(1);
			})
		));

	it("fails writes that are not on the contract", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(
					skills.create("claude-code", "new-skill", "New", "desc")
				);
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result) && result.failure instanceof AgentError) {
					expect(result.failure.operation).toBe("skills.create");
				}
			})
		));

	it("treats an empty library as empty without a library command", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const isEmpty = yield* skills.libraryIsEmpty();
				const listed = yield* skills.libraryListSkills();
				expect(isEmpty).toBe(true);
				expect(listed).toEqual([]);
				expect(emptySkillsCatalog.tree).toEqual([]);
			})
		));
});
