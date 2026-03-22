import { removeExplicitCliFlag, shouldRunClaudeCli } from "./entrypoint-mode.js";
import {
	collectStartupFailureContext,
	logStartupFailure,
	type StartupFailure,
	type StartupMode,
} from "./startup-diagnostics.js";

let startupStage = "bootstrap";
const startupMode: StartupMode = shouldRunClaudeCli(process.argv) ? "cli" : "acp";

function logStaticEntrypointFailure(failure: StartupFailure): void {
	logStartupFailure(
		collectStartupFailureContext("static-entry", startupMode, startupStage),
		failure
	);
}

process.on("uncaughtException", (error) => {
	logStaticEntrypointFailure(error);
	process.exit(1);
});

process.on("unhandledRejection", (reason: StartupFailure) => {
	logStaticEntrypointFailure(reason);
	process.exit(1);
});

async function runStaticEntrypoint(): Promise<void> {
	if (startupMode === "cli") {
		process.argv = removeExplicitCliFlag(process.argv);
		startupStage = "resolve-claude-cli-path";
		const { claudeCliPath } = await import("@zed-industries/claude-agent-acp/dist/acp-agent.js");
		startupStage = "load-claude-cli";
		await import(await claudeCliPath());
		return;
	}

	startupStage = "load-acepe-acp";
	await import("./index.js");
}

await runStaticEntrypoint().catch((error: StartupFailure) => {
	logStaticEntrypointFailure(error);
	process.exit(1);
});
