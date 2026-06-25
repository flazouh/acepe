import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ResultAsync, err, ok } from "neverthrow";
import { z } from "zod";
import type { TargetDoctorResult, TargetProcess } from "./schemas";
import { executeWebviewJson, runCommand, type CommandRunner, type TauriMcpFailure } from "./tauri-mcp";

const DEFAULT_APP_IDENTIFIER = "9223";
const DEFAULT_APP_IDENTIFIER_CANDIDATES = ["9223", "9224", "9225", "9226", "9227"];

const webviewPingSchema = z.object({
	url: z.string().nullable(),
	title: z.string().nullable(),
});

export type DoctorOptions = {
	readonly checkoutRoot: string;
	readonly appIdentifier?: string;
	readonly runner?: CommandRunner;
	readonly nowMs?: number;
};

type BinaryFreshness = TargetDoctorResult["binaryFreshness"];

function classifyCommand(command: string, checkoutRoot: string): TargetProcess["kind"] {
	const normalizedRoot = checkoutRoot.endsWith("/") ? checkoutRoot.slice(0, -1) : checkoutRoot;
	const devBinary = `${normalizedRoot}/packages/desktop/src-tauri/target/debug/acepe`;
	if (command.includes(devBinary) || command.includes("target/debug/acepe")) {
		return "dev";
	}
	if (command.includes("bun run tauri") || command.includes("tauri dev")) {
		return "dev";
	}
	if (command.includes("/Applications/Acepe.app") || command.includes("Acepe.app/Contents/MacOS")) {
		return "production";
	}
	return "other";
}

export function parseProcessList(stdout: string, checkoutRoot: string): readonly TargetProcess[] {
	const processes: TargetProcess[] = [];
	for (const rawLine of stdout.split("\n")) {
		const line = rawLine.trim();
		const match = /^(\d+)\s+(.+)$/.exec(line);
		if (match === null) {
			continue;
		}
		const pid = Number(match[1]);
		if (!Number.isFinite(pid)) {
			continue;
		}
		const command = match[2] ?? "";
		processes.push({
			pid,
			command,
			kind: classifyCommand(command, checkoutRoot),
		});
	}
	return processes;
}

function detectPort(processes: readonly TargetProcess[], fallback: string): string {
	for (const process of processes) {
		const portMatch = /(?:--port|--app-identifier)\s+(\d+)/.exec(process.command);
		if (portMatch !== null) {
			return portMatch[1] ?? fallback;
		}
	}
	return fallback;
}

function appIdentifierCandidates(primary: string): readonly string[] {
	const candidates = [primary];
	for (const candidate of DEFAULT_APP_IDENTIFIER_CANDIDATES) {
		if (!candidates.includes(candidate)) {
			candidates.push(candidate);
		}
	}
	return candidates;
}

function probeWebview(
	appIdentifiers: readonly string[],
	runner: CommandRunner,
	index: number = 0
): ResultAsync<{ readonly port: string; readonly webview: z.infer<typeof webviewPingSchema> }, TauriMcpFailure> {
	const port = appIdentifiers[index] ?? DEFAULT_APP_IDENTIFIER;
	return executeWebviewJson(
		{
			appIdentifier: port,
			script: "(() => ({ url: window.location.href || null, title: document.title || null }))()",
			schema: webviewPingSchema,
			callTimeoutMs: 5_000,
		},
		runner
	).map((webview) => ({
		port,
		webview,
	})).orElse((failure) => {
		const nextIndex = index + 1;
		if (nextIndex >= appIdentifiers.length) {
			return err(failure);
		}
		return probeWebview(appIdentifiers, runner, nextIndex);
	});
}

function latestSourceMtime(paths: readonly string[]): ResultAsync<number, TauriMcpFailure> {
	const reads = paths.map((path) =>
		ResultAsync.fromPromise(
			stat(path),
			(error) => {
				const message = error instanceof Error ? error.message : "Unable to stat source file.";
				return {
					code: "stat_failed",
					message,
				};
			}
		).map((stats) => stats.mtimeMs)
	);
	return ResultAsync.combine(reads).map((times) => {
		let latest = 0;
		for (const time of times) {
			latest = Math.max(latest, time);
		}
		return latest;
	});
}

function binaryFreshness(checkoutRoot: string): ResultAsync<BinaryFreshness, TauriMcpFailure> {
	const binaryPath = join(checkoutRoot, "packages/desktop/src-tauri/target/debug/acepe");
	const sourcePaths = [
		join(checkoutRoot, "packages/desktop/src-tauri/src/main.rs"),
		join(checkoutRoot, "packages/desktop/src-tauri/src/lib.rs"),
	];
	const binaryStat = ResultAsync.fromPromise(
		stat(binaryPath),
		(error) => {
			const message = error instanceof Error ? error.message : "Unable to stat dev binary.";
			return {
				code: "stat_failed",
				message,
			};
		}
	);
	return binaryStat
		.andThen((stats) =>
			latestSourceMtime(sourcePaths).map((latestSource) => {
				if (latestSource > stats.mtimeMs) {
					return {
						status: "stale",
						message: "Rust source is newer than target/debug/acepe.",
					} satisfies BinaryFreshness;
				}
				return {
					status: "fresh",
					message: "target/debug/acepe is newer than checked Rust entry files.",
				} satisfies BinaryFreshness;
			})
		)
		.orElse((failure) =>
			ok({
				status: "unknown",
				message: failure.message,
			} satisfies BinaryFreshness)
		);
}

function buildFindings(input: {
	readonly devProcesses: readonly TargetProcess[];
	readonly productionProcesses: readonly TargetProcess[];
	readonly bridgeAvailable: boolean;
	readonly binaryFreshness: BinaryFreshness;
	readonly webviewResponsive: boolean;
	readonly webviewError: string | null;
}): string[] {
	const findings: string[] = [];
	if (input.devProcesses.length === 0) {
		findings.push("No Acepe dev app process was detected.");
	}
	if (input.productionProcesses.length > 0 && input.devProcesses.length === 0) {
		findings.push("Only production Acepe appears to be running; dev QA is not valid.");
	}
	if (!input.bridgeAvailable) {
		findings.push("The Tauri MCP bridge did not respond.");
	}
	if (input.binaryFreshness.status === "stale") {
		findings.push(input.binaryFreshness.message);
	}
	if (!input.webviewResponsive && input.webviewError !== null) {
		findings.push(input.webviewError);
	}
	return findings;
}

function statusFromFindings(findings: readonly string[], binaryFreshness: BinaryFreshness): TargetDoctorResult["status"] {
	if (findings.some((finding) => finding.includes("production Acepe") || finding.includes("did not respond"))) {
		return "fail";
	}
	if (findings.length > 0 || binaryFreshness.status !== "fresh") {
		return "warn";
	}
	return "ok";
}

export function runDoctor(options: DoctorOptions): ResultAsync<TargetDoctorResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	const appIdentifier = options.appIdentifier ?? DEFAULT_APP_IDENTIFIER;
	return runner(["ps", "-axo", "pid=,command="])
		.andThen((execution) => {
			if (execution.code !== 0) {
				return err({
					code: "process_list_failed",
					message: execution.stderr.trim() || "Unable to list running processes.",
				});
			}
			return ok(parseProcessList(execution.stdout, options.checkoutRoot));
		})
		.andThen((processes) => {
			const devProcesses = processes.filter((process) => process.kind === "dev");
			const productionProcesses = processes.filter((process) => process.kind === "production");
			const port = detectPort(devProcesses, appIdentifier);
			const appIdentifiers = appIdentifierCandidates(port);
			return binaryFreshness(options.checkoutRoot).andThen((freshness) =>
				probeWebview(appIdentifiers, runner)
					.map((probe) => {
						const findings = buildFindings({
							devProcesses,
							productionProcesses,
							bridgeAvailable: true,
							binaryFreshness: freshness,
							webviewResponsive: true,
							webviewError: null,
						});
						return {
							checkoutRoot: options.checkoutRoot,
							appIdentifier: probe.port,
							status: statusFromFindings(findings, freshness),
							devProcessCount: devProcesses.length,
							productionProcessCount: productionProcesses.length,
							devProcesses,
							productionProcesses,
							bridge: {
								port: probe.port,
								available: true,
							},
							binaryFreshness: freshness,
							webview: {
								responsive: true,
								url: probe.webview.url,
								title: probe.webview.title,
								error: null,
							},
							findings,
						} satisfies TargetDoctorResult;
					})
					.orElse((failure) => {
						const findings = buildFindings({
							devProcesses,
							productionProcesses,
							bridgeAvailable: false,
							binaryFreshness: freshness,
							webviewResponsive: false,
							webviewError: failure.message,
						});
						return ok({
							checkoutRoot: options.checkoutRoot,
							appIdentifier: port,
							status: statusFromFindings(findings, freshness),
							devProcessCount: devProcesses.length,
							productionProcessCount: productionProcesses.length,
							devProcesses,
							productionProcesses,
							bridge: {
								port,
								available: false,
							},
							binaryFreshness: freshness,
							webview: {
								responsive: false,
								url: null,
								title: null,
								error: failure.message,
							},
							findings,
						} satisfies TargetDoctorResult);
					})
			);
		});
}
