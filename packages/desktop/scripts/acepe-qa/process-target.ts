import { join } from "node:path";
import { ResultAsync, err, ok } from "neverthrow";
import { z } from "zod";
import type { TargetDoctorResult, TargetProcess } from "./schemas";
import {
	executeWebviewJson,
	runCommand,
	type CommandRunner,
	type TauriMcpFailure,
} from "./tauri-mcp";

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
type FrontendFreshness = TargetDoctorResult["frontendFreshness"];

function classifyCommand(command: string, checkoutRoot: string): TargetProcess["kind"] {
	const normalizedRoot = checkoutRoot.endsWith("/") ? checkoutRoot.slice(0, -1) : checkoutRoot;
	const devBinary = `${normalizedRoot}/packages/desktop/src-tauri/target/debug/acepe`;
	const devBundleBinary = `${normalizedRoot}/packages/desktop/src-tauri/target/debug/bundle/macos/Acepe Dev QA.app/Contents/MacOS/acepe`;
	if (command.includes(devBinary) || command.includes("target/debug/acepe")) {
		return "dev";
	}
	if (
		command.includes(devBundleBinary) ||
		command.includes("target/debug/bundle/macos/Acepe Dev QA.app/Contents/MacOS/acepe")
	) {
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
): ResultAsync<
	{ readonly port: string; readonly webview: z.infer<typeof webviewPingSchema> },
	TauriMcpFailure
> {
	const port = appIdentifiers[index] ?? DEFAULT_APP_IDENTIFIER;
	return executeWebviewJson(
		{
			appIdentifier: port,
			script: "(() => ({ url: window.location.href || null, title: document.title || null }))()",
			schema: webviewPingSchema,
			callTimeoutMs: 5_000,
		},
		runner
	)
		.map((webview) => ({
			port,
			webview,
		}))
		.orElse((failure) => {
			const nextIndex = index + 1;
			if (nextIndex >= appIdentifiers.length) {
				return err(failure);
			}
			return probeWebview(appIdentifiers, runner, nextIndex);
		});
}

function binaryFreshness(
	checkoutRoot: string,
	runner: CommandRunner
): ResultAsync<BinaryFreshness, TauriMcpFailure> {
	const binaryPath = join(checkoutRoot, "packages/desktop/src-tauri/target/debug/acepe");
	const sourceRoot = join(checkoutRoot, "packages/desktop/src-tauri/src");
	return runner(["find", sourceRoot, "-name", "*.rs", "-newer", binaryPath])
		.andThen((execution) => {
			if (execution.code !== 0) {
				return err({
					code: "binary_freshness_failed",
					message:
						execution.stderr.trim() ||
						execution.stdout.trim() ||
						"Unable to compare Rust sources with the dev binary.",
				});
			}
			const staleSources = execution.stdout
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			if (staleSources.length > 0) {
				const firstSources = staleSources
					.slice(0, 3)
					.map((source) =>
						source.startsWith(checkoutRoot) ? source.slice(checkoutRoot.length + 1) : source
					)
					.join(", ");
				return ok({
					status: "stale",
					message: `Rust source is newer than target/debug/acepe: ${firstSources}`,
				} satisfies BinaryFreshness);
			}
			return ok({
				status: "fresh",
				message: "target/debug/acepe is newer than all checked Rust sources.",
			} satisfies BinaryFreshness);
		})
		.orElse((failure) =>
			ok({
				status: "unknown",
				message: failure.message,
			} satisfies BinaryFreshness)
		);
}

function webviewUsesLiveVite(url: string | null): boolean {
	return (
		url !== null &&
		(url.startsWith("http://localhost:1420") || url.startsWith("http://127.0.0.1:1420"))
	);
}

function findFrontendSourcesNewerThanBuild(
	checkoutRoot: string,
	sourceRoot: string,
	buildRoot: string,
	runner: CommandRunner
): ResultAsync<readonly string[], TauriMcpFailure> {
	return runner([
		"find",
		sourceRoot,
		"-type",
		"f",
		"(",
		"-name",
		"*.css",
		"-o",
		"-name",
		"*.js",
		"-o",
		"-name",
		"*.svelte",
		"-o",
		"-name",
		"*.ts",
		")",
		"-newer",
		buildRoot,
	]).andThen((execution) => {
		if (execution.code !== 0) {
			return err({
				code: "frontend_freshness_failed",
				message:
					execution.stderr.trim() ||
					execution.stdout.trim() ||
					"Unable to compare frontend sources with the built frontend.",
			});
		}
		const sources = execution.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((source) =>
				source.startsWith(checkoutRoot) ? source.slice(checkoutRoot.length + 1) : source
			);
		return ok(sources);
	});
}

function frontendFreshness(
	checkoutRoot: string,
	webviewUrl: string | null,
	runner: CommandRunner
): ResultAsync<FrontendFreshness, TauriMcpFailure> {
	if (webviewUsesLiveVite(webviewUrl)) {
		return ok({
			status: "fresh",
			message: "WebView is using the live Vite dev server.",
		} satisfies FrontendFreshness);
	}

	const buildRoot = join(checkoutRoot, "packages/desktop/build");
	const desktopSourceRoot = join(checkoutRoot, "packages/desktop/src");
	const uiSourceRoot = join(checkoutRoot, "packages/ui/src");
	return findFrontendSourcesNewerThanBuild(checkoutRoot, desktopSourceRoot, buildRoot, runner)
		.andThen((desktopSources) =>
			findFrontendSourcesNewerThanBuild(checkoutRoot, uiSourceRoot, buildRoot, runner).map(
				(uiSources) => desktopSources.concat(uiSources)
			)
		)
		.map((staleSources) => {
			if (staleSources.length === 0) {
				return {
					status: "fresh",
					message: "Built frontend is newer than checked desktop/ui sources.",
				} satisfies FrontendFreshness;
			}
			return {
				status: "stale",
				message: `Frontend source is newer than packages/desktop/build while WebView is not using Vite: ${staleSources
					.slice(0, 3)
					.join(", ")}`,
			} satisfies FrontendFreshness;
		})
		.orElse((failure) =>
			ok({
				status: "unknown",
				message: failure.message,
			} satisfies FrontendFreshness)
		);
}

function buildFindings(input: {
	readonly devProcesses: readonly TargetProcess[];
	readonly productionProcesses: readonly TargetProcess[];
	readonly bridgeAvailable: boolean;
	readonly binaryFreshness: BinaryFreshness;
	readonly frontendFreshness: FrontendFreshness;
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
	if (input.frontendFreshness.status === "stale") {
		findings.push(input.frontendFreshness.message);
	}
	if (!input.webviewResponsive && input.webviewError !== null) {
		findings.push(input.webviewError);
	}
	return findings;
}

function statusFromFindings(
	findings: readonly string[],
	binaryFreshness: BinaryFreshness,
	frontendFreshness: FrontendFreshness
): TargetDoctorResult["status"] {
	if (
		findings.some(
			(finding) => finding.includes("production Acepe") || finding.includes("did not respond")
		)
	) {
		return "fail";
	}
	if (findings.length > 0 || binaryFreshness.status !== "fresh") {
		return "warn";
	}
	if (frontendFreshness.status !== "fresh") {
		return "warn";
	}
	return "ok";
}

export function runDoctor(
	options: DoctorOptions
): ResultAsync<TargetDoctorResult, TauriMcpFailure> {
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
			return binaryFreshness(options.checkoutRoot, runner).andThen((freshness) =>
				probeWebview(appIdentifiers, runner)
					.andThen((probe) =>
						frontendFreshness(options.checkoutRoot, probe.webview.url, runner).map(
							(frontend) => ({ probe, frontend })
						)
					)
					.map(({ probe, frontend }) => {
						const findings = buildFindings({
							devProcesses,
							productionProcesses,
							bridgeAvailable: true,
							binaryFreshness: freshness,
							frontendFreshness: frontend,
							webviewResponsive: true,
							webviewError: null,
						});
						return {
							checkoutRoot: options.checkoutRoot,
							appIdentifier: probe.port,
							status: statusFromFindings(findings, freshness, frontend),
							devProcessCount: devProcesses.length,
							productionProcessCount: productionProcesses.length,
							devProcesses,
							productionProcesses,
							bridge: {
								port: probe.port,
								available: true,
							},
							binaryFreshness: freshness,
							frontendFreshness: frontend,
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
							frontendFreshness: {
								status: "unknown",
								message: "WebView was not responsive, so frontend freshness could not be checked.",
							},
							webviewResponsive: false,
							webviewError: failure.message,
						});
						const frontend: FrontendFreshness = {
							status: "unknown",
							message: "WebView was not responsive, so frontend freshness could not be checked.",
						};
						return ok({
							checkoutRoot: options.checkoutRoot,
							appIdentifier: port,
							status: statusFromFindings(findings, freshness, frontend),
							devProcessCount: devProcesses.length,
							productionProcessCount: productionProcesses.length,
							devProcesses,
							productionProcesses,
							bridge: {
								port,
								available: false,
							},
							binaryFreshness: freshness,
							frontendFreshness: frontend,
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
