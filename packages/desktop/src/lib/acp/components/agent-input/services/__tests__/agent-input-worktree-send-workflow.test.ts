import { describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import type { CommandOutput } from "$lib/acp/types/worktree-config.js";
import type { WorktreeSetupEvent } from "$lib/acp/types/worktree-setup.js";

import {
	createWorktreeCreationState,
	reduceWorktreeSetupEvent,
	type WorktreeSetupState,
} from "../../../agent-panel/logic/worktree-setup-events.js";

const PROJECT_PATH = "/repo";
const WORKTREE_PATH = "/wt/repo-a";

let setupCommands: string[] = [];
let setupOutputs: CommandOutput[] = [];
let setupSuccess = true;
let setupError: string | null = null;

mock.module("../../../../../utils/backend-client.js", () => ({
	backendClient: {
		git: {
			prepareWorktreeSessionLaunch: () =>
				Effect.succeed({
					worktree: { directory: WORKTREE_PATH },
					launchToken: "token",
					sequenceId: "seq",
				}),
			loadWorktreeConfig: () => Effect.succeed({ setupCommands }),
			runWorktreeSetup: () =>
				Effect.succeed({
					success: setupSuccess,
					commandsRun: setupOutputs.length,
					error: setupError,
					output: setupOutputs,
				}),
		},
	},
}));

mock.module("svelte-sonner", () => ({
	toast: { warning: () => {}, error: () => {}, success: () => {} },
}));

const { prepareWorktreePathForPendingSend } = await import(
	"../agent-input-worktree-send-workflow.js"
);

/**
 * Drive one first-send worktree preparation and fold the events it reports the
 * way the panel does, resolving when the run reports its terminal event.
 */
async function runSendAndFoldCard(): Promise<WorktreeSetupState | null> {
	let card: WorktreeSetupState | null = null;
	let settle: (() => void) | null = null;
	const settled = new Promise<void>((resolve) => {
		settle = resolve;
	});

	const prep = await prepareWorktreePathForPendingSend({
		projectPath: PROJECT_PATH,
		selectedAgentId: "claude",
		existingPrepared: null,
		notifyCreating: () => {
			card = createWorktreeCreationState({ projectPath: PROJECT_PATH });
		},
		onSetupEvent: (event: WorktreeSetupEvent) => {
			card = reduceWorktreeSetupEvent(card, event);
			if (event.kind === "finished") {
				settle?.();
			}
		},
	});

	expect(prep.ok).toBe(true);
	await settled;
	return card;
}

describe("prepareWorktreePathForPendingSend setup reporting", () => {
	it("drives the setup card to a terminal success state carrying the command output", async () => {
		setupCommands = ["echo ACEPE_SETUP_MARKER"];
		setupOutputs = [
			{
				command: "echo ACEPE_SETUP_MARKER",
				success: true,
				stdout: "ACEPE_SETUP_MARKER\n",
				stderr: "",
				exitCode: 0,
			},
		];
		setupSuccess = true;
		setupError = null;

		const card = await runSendAndFoldCard();

		expect(card).not.toBeNull();
		expect(card?.status).toBe("succeeded");
		expect(card?.worktreePath).toBe(WORKTREE_PATH);
		expect(card?.commandCount).toBe(1);
		expect(card?.outputText).toContain("$ echo ACEPE_SETUP_MARKER");
		expect(card?.outputText).toContain("ACEPE_SETUP_MARKER");
		expect(card?.isVisible).toBe(true);
	});

	it("drives the setup card to failed when a setup command exits non-zero", async () => {
		setupCommands = ["echo ACEPE_SETUP_BOOM >&2; exit 3"];
		setupOutputs = [
			{
				command: "echo ACEPE_SETUP_BOOM >&2; exit 3",
				success: false,
				stdout: "",
				stderr: "ACEPE_SETUP_BOOM\n",
				exitCode: 3,
			},
		];
		setupSuccess = false;
		setupError = "ACEPE_SETUP_BOOM";

		const card = await runSendAndFoldCard();

		expect(card).not.toBeNull();
		expect(card?.status).toBe("failed");
		expect(card?.isVisible).toBe(true);
		expect(card?.error).toBe("ACEPE_SETUP_BOOM");
		expect(card?.outputText).toContain("ACEPE_SETUP_BOOM");
	});

	it("leaves no setup card behind when the project configures no setup commands", async () => {
		setupCommands = [];
		setupOutputs = [];
		setupSuccess = true;
		setupError = null;

		const card = await runSendAndFoldCard();

		expect(card?.status).toBe("succeeded");
		expect(card?.isVisible).toBe(false);
		expect(card?.outputText).toBe("");
	});
});
