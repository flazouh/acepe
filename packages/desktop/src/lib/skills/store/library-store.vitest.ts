import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "../../acp/errors/app-error";

const isEmpty = vi.fn();
const importExisting = vi.fn();
const listSkillsWithSync = vi.fn();
const listPlugins = vi.fn();

vi.mock("../api/skills-api.js", () => ({
	libraryApi: {
		listSkills: vi.fn(),
		listSkillsWithSync: (...args: unknown[]) => listSkillsWithSync(...args),
		getSkill: vi.fn(),
		createSkill: vi.fn(),
		updateSkill: vi.fn(),
		deleteSkill: vi.fn(),
		getSyncTargets: vi.fn(),
		setSyncTarget: vi.fn(),
		syncSkill: vi.fn(),
		syncAll: vi.fn(),
		isEmpty: (...args: unknown[]) => isEmpty(...args),
		importExisting: (...args: unknown[]) => importExisting(...args),
		getSkillFolderPath: vi.fn(),
		deleteSkillFromAgents: vi.fn(),
	},
	pluginSkillsApi: {
		listPlugins: (...args: unknown[]) => listPlugins(...args),
		listPluginSkills: vi.fn(),
		getPluginSkill: vi.fn(),
		copyPluginSkillToAgent: vi.fn(),
	},
}));

let LibraryStore: typeof import("./library-store.svelte.js").LibraryStore;

describe("LibraryStore.initialize", () => {
	beforeEach(async () => {
		isEmpty.mockReset();
		importExisting.mockReset();
		listSkillsWithSync.mockReset();
		listPlugins.mockReset();
		listPlugins.mockReturnValue(Effect.succeed([]));
		listSkillsWithSync.mockReturnValue(Effect.succeed([]));
		({ LibraryStore } = await import("./library-store.svelte.js"));
	});

	it("does not surface an error when the first-run import is unsupported on the contract", async () => {
		isEmpty.mockReturnValue(Effect.succeed(true));
		importExisting.mockReturnValue(
			Effect.fail(
				new AgentError(
					"skills.libraryImportExisting",
					new Error("skills.libraryImportExisting is not on the orchestration contract")
				)
			)
		);

		const store = new LibraryStore();
		const result = await Effect.runPromise(Effect.result(store.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(store.error).toBeNull();
		expect(listSkillsWithSync).toHaveBeenCalledTimes(1);
	});

	it("still surfaces a real first-run import failure", async () => {
		isEmpty.mockReturnValue(Effect.succeed(true));
		importExisting.mockReturnValue(
			Effect.fail(new AgentError("skills.libraryImportExisting", new Error("disk read failed")))
		);

		const store = new LibraryStore();
		const result = await Effect.runPromise(Effect.result(store.initialize()));

		expect(Result.isFailure(result)).toBe(true);
		expect(store.error).toBe("Agent operation failed: skills.libraryImportExisting");
	});

	it("skips the import entirely when the library already has skills", async () => {
		isEmpty.mockReturnValue(Effect.succeed(false));

		const store = new LibraryStore();
		const result = await Effect.runPromise(Effect.result(store.initialize()));

		expect(Result.isSuccess(result)).toBe(true);
		expect(importExisting).not.toHaveBeenCalled();
		expect(store.error).toBeNull();
	});
});
