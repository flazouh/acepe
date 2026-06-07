import { writeJsonArtifact } from "./artifacts";
import { writeUiQaEvidence } from "./evidence";
import { clickWebview, inspectDom, resetOnboarding } from "./interact";
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
	readonly selector: string;
	readonly text: string;
	readonly limit: number;
	readonly delayMs: number;
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
			selector: "",
			text: "",
			limit: 10,
			delayMs: 300,
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
		selector: valueArg(args, "--selector", ""),
		text: valueArg(args, "--text", ""),
		limit: Number.parseInt(valueArg(args, "--limit", "10"), 10),
		delayMs: Number.parseInt(valueArg(args, "--delay", "300"), 10),
		skipDriver: hasArg(args, "--skip-driver"),
	};
}

async function emitVerifiedUiResult(options: CliOptions, result: ReturnType<typeof buildResult>): Promise<number> {
	const evidence = await writeUiQaEvidence({
		checkoutRoot: options.checkoutRoot,
		command: result.command,
		status: result.status,
		summary: result.summary,
		artifactPath: result.artifact?.path,
	});
	const output =
		evidence.isOk()
			? {
					command: result.command,
					status: result.status,
					summary: result.summary.concat(`ui qa evidence: ${evidence.value}`),
					artifact: result.artifact,
					error: result.error,
				}
			: result;
	process.stdout.write(formatCommandResult(output, options.format));
	return statusExitCode(result.status);
}

export async function runCli(args: readonly string[], checkoutRoot: string = process.cwd()): Promise<number> {
	const options = parseOptions(args, checkoutRoot);
	if (options.command === "help") {
		const result = buildResult({
			command: "help",
			status: "ok",
			summary: [
				"usage: bun run qa [doctor|observe|screenshot|inspect|click|reset-onboarding] [--app=9223] [--format=json]",
				"doctor checks the real dev Tauri target before QA.",
				"observe returns compact app facts before screenshots.",
				"screenshot captures the current WebView.",
				"inspect returns compact DOM facts for --selector.",
				"click clicks by --selector or --text.",
				"reset-onboarding opens Dev Tools, resets onboarding, and returns onboarding facts.",
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
		return emitVerifiedUiResult(options, result);
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
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "inspect") {
		if (options.selector.length === 0) {
			const result = buildResult({
				command: "inspect",
				status: "fail",
				summary: ["Missing --selector."],
				error: dependencyError("missing_selector", "--selector is required.", "Example: bun run qa inspect --selector=.onboarding-preview-panel"),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const inspection = await inspectDom({
			appIdentifier: options.appIdentifier,
			selector: options.selector,
			limit: Number.isFinite(options.limit) ? options.limit : 10,
			skipDriver: options.skipDriver,
		});
		if (inspection.isErr()) {
			const result = buildResult({
				command: "inspect",
				status: "fail",
				summary: ["Unable to inspect the Acepe WebView DOM."],
				error: dependencyError(
					inspection.error.code,
					inspection.error.message,
					"Run acepe-qa doctor, then retry inspect with a selector."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("inspect", inspection.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const first = inspection.value.elements[0];
		const summary = [
			`selector: ${inspection.value.selector}`,
			`matches: ${inspection.value.count.toString()}`,
			`returned: ${inspection.value.elements.length.toString()}`,
			first === undefined ? "first: none" : `first: ${first.tag} ${first.rect.width.toFixed(0)}x${first.rect.height.toFixed(0)} "${first.text.slice(0, 80)}"`,
			first?.src === undefined || first.src === null ? "src: none" : `src: ${first.src}`,
			first === undefined ? "computed: none" : `computed: display=${first.computedStyle.display} gap=${first.computedStyle.gap} rowGap=${first.computedStyle.rowGap} columnGap=${first.computedStyle.columnGap}`,
			first === undefined ? "padding: none" : `padding: top=${first.computedStyle.paddingTop} right=${first.computedStyle.paddingRight} bottom=${first.computedStyle.paddingBottom} left=${first.computedStyle.paddingLeft}`,
			first === undefined ? "animation: none" : `animation: name=${first.computedStyle.animationName} duration=${first.computedStyle.animationDuration} delay=${first.computedStyle.animationDelay} iteration=${first.computedStyle.animationIterationCount}`,
		];
		const result = buildResult({
			command: "inspect",
			status: "ok",
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "inspect",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "click") {
		if (options.selector.length === 0 && options.text.length === 0) {
			const result = buildResult({
				command: "click",
				status: "fail",
				summary: ["Missing --selector or --text."],
				error: dependencyError("missing_target", "Click needs a selector or text.", "Example: bun run qa click --text='Reset Onboarding'"),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const click = await clickWebview({
			appIdentifier: options.appIdentifier,
			selector: options.selector.length === 0 ? null : options.selector,
			text: options.text.length === 0 ? null : options.text,
			skipDriver: options.skipDriver,
		});
		if (click.isErr()) {
			const result = buildResult({
				command: "click",
				status: "fail",
				summary: ["Unable to click in the Acepe WebView."],
				error: dependencyError(click.error.code, click.error.message, "Run acepe-qa doctor, then retry click."),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("click", click.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "click",
			status: click.value.clicked ? "ok" : "warn",
			summary: [
				`clicked: ${click.value.clicked ? "yes" : "no"}`,
				click.value.match === null ? "match: none" : `match: ${click.value.match.tag} "${click.value.match.text.slice(0, 80)}"`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "click",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "reset-onboarding") {
		const reset = await resetOnboarding({
			appIdentifier: options.appIdentifier,
			delayMs: Number.isFinite(options.delayMs) ? options.delayMs : 300,
			skipDriver: options.skipDriver,
		});
		if (reset.isErr()) {
			const result = buildResult({
				command: "reset-onboarding",
				status: "fail",
				summary: ["Unable to reset onboarding in the Acepe WebView."],
				error: dependencyError(reset.error.code, reset.error.message, "Run acepe-qa doctor, then retry reset-onboarding."),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("reset-onboarding", reset.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "reset-onboarding",
			status: reset.value.clickedDevTools && reset.value.clickedReset && reset.value.hasWelcome ? "ok" : "warn",
			summary: [
				`dev tools: ${reset.value.clickedDevTools ? "clicked" : "missing"}`,
				`reset: ${reset.value.clickedReset ? "clicked" : "missing"}`,
				`welcome: ${reset.value.hasWelcome ? "visible" : "missing"}`,
				`panels: ${reset.value.panelCount.toString()}`,
				`animated: ${reset.value.animated.length.toString()}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "reset-onboarding",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	const result = buildResult({
		command: options.command,
		status: "fail",
		summary: ["Unknown command."],
		error: dependencyError("unknown_command", options.command, "Use doctor, observe, screenshot, inspect, click, or reset-onboarding."),
	});
	process.stdout.write(formatCommandResult(result, options.format));
	return statusExitCode(result.status);
}
