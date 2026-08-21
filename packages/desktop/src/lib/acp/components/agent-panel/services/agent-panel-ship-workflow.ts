/**
 * Create PR / merge PR workflows — async orchestration previously embedded in agent-panel.svelte.
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { toast } from "svelte-sonner";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { GitStackedPrStep } from "../../../../utils/tauri-client/git.js";
import { getErrorCauseDetails } from "../../../errors/error-cause-details.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { createLogger } from "../../../utils/logger.js";
import type { PrGenerationConfig } from "../../modified-files/types/pr-generation-config.js";
import type { ShipCardData } from "../../ship-card/ship-card-parser.js";

const logger = createLogger({ id: "agent-panel-ship-workflow", name: "AgentPanelShipWorkflow" });

export interface CreatePrWorkflowDeps {
	applyAutomaticSessionPrLink: (
		sessionId: string,
		projectPath: string,
		pr: GitStackedPrStep
	) => Promise<number | null>;
}

/**
 * Stages modified files, optionally generates commit/PR copy, then commit+push+PR via Tauri.
 * Streaming UI updates are driven via `onStreamUpdate` / `onStreamReset` so the controller owns render keys.
 */
export async function runCreatePrWorkflow(args: {
	path: string;
	sessionId: string | null;
	modifiedFilesState: ModifiedFilesState | null;
	config: PrGenerationConfig | undefined;
	effectivePanelAgentId: string | null;
	setCreatePrRunning: (running: boolean) => void;
	setCreatePrLabel: (label: string | null) => void;
	onStreamReset: () => void;
	onStreamUpdate: (data: ShipCardData) => void;
	deps: CreatePrWorkflowDeps;
}): Promise<void> {
	const {
		path,
		sessionId,
		modifiedFilesState,
		config,
		effectivePanelAgentId,
		setCreatePrRunning,
		setCreatePrLabel,
		onStreamReset,
		onStreamUpdate,
		deps,
	} = args;

	logger.info("runCreatePrWorkflow called", { path, sessionId, config });
	if (!path) {
		logger.warn("runCreatePrWorkflow: no path, aborting");
		return;
	}

	setCreatePrRunning(true);
	setCreatePrLabel("Staging…");

	if (modifiedFilesState) {
		const prefix = path.endsWith("/") ? path : `${path}/`;
		const filePaths = modifiedFilesState.files.map((f) =>
			f.filePath.startsWith(prefix) ? f.filePath.slice(prefix.length) : f.filePath
		);
		logger.info("runCreatePrWorkflow: staging modified files", {
			count: filePaths.length,
			filePaths,
		});
		const stageResult = await Effect.runPromise(
			Effect.result(tauriClient.git.stageFiles(path, filePaths))
		);
		if (Result.isFailure(stageResult)) {
			setCreatePrRunning(false);
			setCreatePrLabel(null);
			const details = getErrorCauseDetails(stageResult.failure);
			logger.error("runCreatePrWorkflow: staging failed", {
				rootCause: details.rootCause,
				formatted: details.formatted,
			});
			toast.error(details.rootCause ?? stageResult.failure.message);
			return;
		}
	}

	setCreatePrLabel("Generating...");
	onStreamReset();
	let commitMsg = "Updates from Acepe session";
	let prTitle: string | undefined;
	let prBody: string | undefined;

	const shipCtxResult = await Effect.runPromise(
		Effect.result(
			tauriClient.git.collectShipContext(
				path,
				config?.customPrompt ? config.customPrompt : undefined
			)
		)
	);
	if (Result.isSuccess(shipCtxResult) && shipCtxResult.success) {
		const ctx = shipCtxResult.success;
		logger.info("runCreatePrWorkflow: generating commit/PR content via AI", { branch: ctx.branch });
		const prompt = ctx.prompt;

		const { generateShipContentStreaming } = await import(
			"../../ship-card/ship-card-generation.js"
		);
		const genResult = await Effect.runPromise(
			Effect.result(
				generateShipContentStreaming(
					prompt,
					path,
					onStreamUpdate,
					config?.agentId ? config.agentId : effectivePanelAgentId ? effectivePanelAgentId : undefined,
					config?.modelId ? config.modelId : undefined
				)
			)
		);
		if (Result.isSuccess(genResult)) {
			const gen = genResult.success;
			if (gen.commitMessage) commitMsg = gen.commitMessage as typeof commitMsg;
			if (gen.prTitle) prTitle = gen.prTitle;
			if (gen.prDescription) prBody = gen.prDescription;
			logger.info("runCreatePrWorkflow: AI generation complete", { prTitle, hasBody: !!prBody });
		} else {
			logger.warn("runCreatePrWorkflow: AI generation failed, using defaults", {
				error: genResult.failure.message,
			});
			onStreamReset();
		}
	}

	setCreatePrLabel("Pushing…");
	logger.info("runCreatePrWorkflow: calling runStackedAction", {
		path,
		action: "commit_push_pr",
		commitMsg,
		prTitle,
	});
	await Effect.runPromise(
		tauriClient.git
			.runStackedAction(path, "commit_push_pr", commitMsg, prTitle, prBody)
			.pipe(
				Effect.match({
					onSuccess: (ok) => {
						setCreatePrRunning(false);
						setCreatePrLabel(null);
						onStreamReset();
						logger.info("runCreatePrWorkflow: success", {
							action: ok.action,
							commitStatus: ok.commit.status,
							pushStatus: ok.push.status,
							prStatus: ok.pr.status,
							prUrl: ok.pr.url,
						});
						switch (ok.pr.status) {
							case "created":
								toast.success(`Created PR #${ok.pr.number ?? ""}`);
								break;
							case "opened_existing":
								toast.success(`Opened PR #${ok.pr.number ?? ""}`);
								break;
							case "skipped_not_requested":
								toast.success("Pushed to branch");
								break;
							default: {
								const _: never = ok.pr.status;
								toast.success("Pushed to branch");
							}
						}
						if (ok.pr.status === "created" || ok.pr.status === "opened_existing") {
							if (sessionId) {
								void deps.applyAutomaticSessionPrLink(sessionId, path, ok.pr);
							}
							if (ok.pr.url) void openUrl(ok.pr.url).catch(() => {});
						}
					},
					onFailure: (err) => {
						setCreatePrRunning(false);
						setCreatePrLabel(null);
						onStreamReset();
						const details = getErrorCauseDetails(err);
						logger.error("runCreatePrWorkflow: failed", {
							message: err.message,
							rootCause: details.rootCause,
							chain: details.chain,
							formatted: details.formatted,
						});
						toast.error(details.rootCause ?? err.message);
					},
				})
			)
	);
}

export async function runMergePrWorkflow(args: {
	path: string;
	prNum: number;
	strategy: MergeStrategy;
	setMergePrRunning: (running: boolean) => void;
	onMerged: () => void;
}): Promise<void> {
	const { path, prNum, strategy, setMergePrRunning, onMerged } = args;
	setMergePrRunning(true);
	try {
		await Effect.runPromise(
			tauriClient.git.mergePr(path, prNum, strategy).pipe(
				Effect.match({
					onSuccess: () => {
						toast.success("PR merged!");
						onMerged();
					},
					onFailure: (err) => {
						const details = getErrorCauseDetails(err);
						toast.error(details.rootCause ?? err.message);
					},
				})
			)
		);
	} finally {
		setMergePrRunning(false);
	}
}
