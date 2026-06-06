import { writeJsonArtifact } from "./artifacts";
import { observeApp, screenshotApp } from "./observe";
import { buildResult, dependencyError, formatCommandResult, statusExitCode, type OutputFormat } from "./output";
import { runDoctor } from "./process-target";
import { observeLevelSchema } from "./schemas";

type CliOptions = {
	readonly command: string;
	readonly appIdentifier: string;
	readonly checkoutRoot: string;
	readonly format: OutputFormat;
	readonly level: "summary" | "focused" | "raw";
	readonly skipDriver: boolean;
};

function valueArg(args: readonly string[], name: string, fallback: string): string {
	const prefix = `${name}=`;
	const directIndex = args.indexOf(name);
	if (directIndex >= 0) {
		return args[directIndex + 1] ?? fallback;
	}
	const value = args.find((arg) => arg.startsWith(prefix));
	if (value === undefined) {
		return fallback;
	}
	const parsed = value.slice(prefix.length).trim();
	return parsed.length > 0 ? parsed : fallback;
}

function hasArg(args: readonly string[], name: string): boolean {
	return args.includes(name);
}

function parseOptions(args: readonly string[], checkoutRoot: string): CliOptions {
	if (hasArg(args, "--help") || hasArg(args, "-h")) {
		return {
			command: "help",
			appIdentifier: "9223",
			checkoutRoot,
			format: "text",
			level: "summary",
			skipDriver: false,
		};
	}
	const command = args.find((arg) => !arg.startsWith("--")) ?? "doctor";
	const formatArg = valueArg(args, "--format", "text");
	const format: OutputFormat = formatArg === "json" ? "json" : "text";
	const levelCandidate = valueArg(args, "--level", "summary");
	const levelParsed = observeLevelSchema.safeParse(levelCandidate);
	const level = levelParsed.success ? levelParsed.data : "summary";
	return {
		command,
		appIdentifier: valueArg(args, "--app", "9223"),
		checkoutRoot,
		format,
		level,
		skipDriver: hasArg(args, "--skip-driver"),
	};
}

export async function runCli(args: readonly string[], checkoutRoot: string = process.cwd()): Promise<number> {
	const options = parseOptions(args, checkoutRoot);
	if (options.command === "help") {
		const result = buildResult({
			command: "help",
			status: "ok",
			summary: [
				"usage: bun run qa [doctor|observe|screenshot] [--app=9223] [--format=json]",
				"doctor checks the real dev Tauri target before QA.",
				"observe returns compact app facts before screenshots.",
				"screenshot captures the current WebView.",
			],
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return 0;
	}

	if (options.command === "doctor") {
		const doctor = await runDoctor({
			checkoutRoot: options.checkoutRoot,
			appIdentifier: options.appIdentifier,
		});
		if (doctor.isErr()) {
			const result = buildResult({
				command: "doctor",
				status: "fail",
				summary: ["Unable to inspect the Acepe dev target."],
				error: dependencyError(
					doctor.error.code,
					doctor.error.message,
					"Check that the dev app is running, then rerun acepe-qa doctor."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("doctor", doctor.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const summary = [
			`dev processes: ${doctor.value.devProcessCount.toString()}`,
			`production processes: ${doctor.value.productionProcessCount.toString()}`,
			`bridge ${doctor.value.bridge.available ? "ok" : "missing"} on ${doctor.value.bridge.port}`,
			`webview ${doctor.value.webview.responsive ? "responsive" : "not responsive"}`,
			`binary: ${doctor.value.binaryFreshness.status}`,
		].concat(doctor.value.findings);
		const result = buildResult({
			command: "doctor",
			status: doctor.value.status,
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "doctor",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return statusExitCode(result.status);
	}

	if (options.command === "observe") {
		const observation = await observeApp({
			appIdentifier: options.appIdentifier,
			level: options.level,
			skipDriver: options.skipDriver,
		});
		if (observation.isErr()) {
			const result = buildResult({
				command: "observe",
				status: "fail",
				summary: ["Unable to observe the Acepe WebView."],
				error: dependencyError(
					observation.error.code,
					observation.error.message,
					"Run acepe-qa doctor, then retry observe with the reported app port."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("observe", observation.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const summary = [
			`url: ${observation.value.url ?? "unknown"}`,
			`panels: ${observation.value.panelCount.toString()}`,
			`composer: ${observation.value.composer.present ? "present" : "missing"}`,
			`visible errors: ${observation.value.visibleSessionErrors.length.toString()}`,
			`refs: ${observation.value.refs.length.toString()}`,
		];
		const result = buildResult({
			command: "observe",
			status: observation.value.visibleSessionErrors.length > 0 ? "warn" : "ok",
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "observe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return statusExitCode(result.status);
	}

	if (options.command === "screenshot") {
		const screenshot = await screenshotApp({
			appIdentifier: options.appIdentifier,
			skipDriver: options.skipDriver,
		});
		if (screenshot.isErr()) {
			const result = buildResult({
				command: "screenshot",
				status: "fail",
				summary: ["Unable to capture a WebView screenshot."],
				error: dependencyError(
					screenshot.error.code,
					screenshot.error.message,
					"Run acepe-qa doctor before taking screenshots."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("screenshot", screenshot.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "screenshot",
			status: "ok",
			summary: [`screenshot: ${screenshot.value.path}`],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "screenshot",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return statusExitCode(result.status);
	}

	const result = buildResult({
		command: options.command,
		status: "fail",
		summary: ["Unknown command."],
		error: dependencyError("unknown_command", options.command, "Use doctor, observe, or screenshot."),
	});
	process.stdout.write(formatCommandResult(result, options.format));
	return statusExitCode(result.status);
}
