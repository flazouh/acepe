import { spawnSync } from "node:child_process";
import { writeJsonArtifact } from "./artifacts";
import { writeUiQaEvidence } from "./evidence";
import {
	clickWebview,
	inspectDom,
	navigateWebview,
	openStreamingReproLab,
	probePanelResize,
	probePanelResizeStream,
	probeComputerUse,
	probeFirstSendTimeline,
	probeThinkingToggle,
	readPlanningDebug,
	reloadWebview,
	resetOnboarding,
	sendComposer,
	watchForVisibleText,
} from "./interact";
import { observeApp, screenshotApp } from "./observe";
import {
	buildResult,
	dependencyError,
	formatCommandResult,
	statusExitCode,
	type OutputFormat,
} from "./output";
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
	readonly action: string;
	readonly targetLabel: string;
	readonly key: string;
	readonly dx: number | null;
	readonly dy: number | null;
	readonly sessionId: string;
	readonly path: string;
	readonly limit: number;
	readonly delayMs: number;
	readonly timeoutMs: number;
	readonly noSubmit: boolean;
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

function formatAttributes(attributes: Readonly<Record<string, string>>): string {
	const names = ["viewBox", "aria-label", "role", "data-testid", "data-header-control"];
	const parts = names.flatMap((name) => {
		const value = attributes[name];
		return value === undefined ? [] : [`${name}=${JSON.stringify(value)}`];
	});
	return parts.length === 0 ? "none" : parts.join(" ");
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
			action: "",
			targetLabel: "",
			key: "",
			dx: null,
			dy: null,
			sessionId: "",
			path: "",
			limit: 10,
			delayMs: 300,
			timeoutMs: 20_000,
			noSubmit: false,
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
		action: valueArg(args, "--action", ""),
		targetLabel: valueArg(args, "--target-label", ""),
		key: valueArg(args, "--key", ""),
		dx: numberArg(args, "--dx"),
		dy: numberArg(args, "--dy"),
		sessionId: valueArg(args, "--session-id", ""),
		path: valueArg(args, "--path", ""),
		limit: Number.parseInt(valueArg(args, "--limit", "10"), 10),
		delayMs: Number.parseInt(valueArg(args, "--delay", "300"), 10),
		timeoutMs: Number.parseInt(valueArg(args, "--timeout", "20000"), 10),
		noSubmit: hasArg(args, "--no-submit"),
		skipDriver: hasArg(args, "--skip-driver"),
	};
}

function numberArg(args: readonly string[], name: string): number | null {
	const value = valueArg(args, name, "");
	if (value.length === 0) {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function bridgeProcessId(appIdentifier: string): string {
	if (!/^\d+$/.test(appIdentifier)) {
		return "";
	}
	const result = spawnSync("lsof", [`-tiTCP:${appIdentifier}`, "-sTCP:LISTEN"], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		return "";
	}
	return (
		result.stdout
			.split(/\s+/)
			.map((entry) => entry.trim())
			.find((entry) => /^\d+$/.test(entry)) ?? ""
	);
}

function focusAcepeApp(appIdentifier: string): {
	readonly ok: boolean;
	readonly message: string;
} {
	if (process.platform !== "darwin") {
		return {
			ok: false,
			message: "focus-app is currently implemented for macOS only.",
		};
	}
	const pid = bridgeProcessId(appIdentifier);
	const script = [
		'tell application "System Events"',
		pid.length > 0
			? `  set targetProcesses to every process whose unix id is ${pid}`
			: '  set targetProcesses to every process whose bundle identifier is "com.acepe.app"',
		'  if (count of targetProcesses) is 0 then set targetProcesses to every process whose name is "acepe"',
		'  if (count of targetProcesses) is 0 then set targetProcesses to every process whose name is "Acepe"',
		'  if (count of targetProcesses) is 0 then error "Acepe process not found"',
		"  set targetProcess to item 1 of targetProcesses",
		'  if (count of windows of targetProcess) is 0 then error "Acepe process has no accessibility windows"',
		'  set value of attribute "AXFrontmost" of targetProcess to true',
		'  perform action "AXRaise" of window 1 of targetProcess',
		"  set frontmost of targetProcess to true",
		"  delay 0.2",
		'  if frontmost of targetProcess is false then error "Acepe process did not become frontmost"',
		"end tell",
	].join("\n");
	const result = spawnSync("osascript", ["-e", script], {
		encoding: "utf8",
	});
	if (result.status === 0) {
		return {
			ok: true,
			message: pid.length > 0 ? `Acepe app focused via bridge pid ${pid}.` : "Acepe app focused.",
		};
	}
	return {
		ok: false,
		message: result.stderr.trim() || result.stdout.trim() || "Unable to focus Acepe app.",
	};
}

async function emitVerifiedUiResult(
	options: CliOptions,
	result: ReturnType<typeof buildResult>
): Promise<number> {
	const evidence = await writeUiQaEvidence({
		checkoutRoot: options.checkoutRoot,
		command: result.command,
		status: result.status,
		summary: result.summary,
		artifactPath: result.artifact?.path,
	});
	const output = evidence.isOk()
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

export async function runCli(
	args: readonly string[],
	checkoutRoot: string = process.cwd()
): Promise<number> {
	const options = parseOptions(args, checkoutRoot);
	if (options.command === "help") {
		const result = buildResult({
			command: "help",
			status: "ok",
			summary: [
				"usage: bun run qa [doctor|focus-app|observe|screenshot|navigate|reload|inspect|click|computer-probe|resize-probe|resize-stream-probe|thinking-toggle-probe|first-send-probe|streaming-repro-lab|send|watch|reset-onboarding] [--app=9223] [--format=json]",
				"doctor checks the real dev Tauri target before QA.",
				"focus-app brings the Acepe desktop app to the macOS foreground.",
				"observe returns compact app facts before screenshots.",
				"screenshot captures the current WebView.",
				"navigate opens an app route with --path=/some-route.",
				"reload refreshes the current WebView route.",
				"inspect returns compact DOM facts for --selector.",
				"click clicks by --selector or --text.",
				"computer-probe invokes the real app's acepe_computer.act MCP path; add --action and --target-label to act.",
				"resize-probe drags the first panel resize edge and reports frame-by-frame width lag; tune with --dx, --limit steps, --delay ms.",
				"resize-stream-probe streams pointer moves over --timeout ms and reports continuous-drag lag.",
				"thinking-toggle-probe clicks the first thinking block and samples open/closed state over 500ms.",
				"first-send-probe types into the first composer, clicks send, and samples optimistic/planning visibility.",
				"streaming-repro-lab opens the dev Streaming Repro Lab and samples native token reveal DOM.",
				"send types --text into the composer and submits (use --no-submit to type only).",
				"watch polls for --text and reports whether it is actually VISIBLE (not just in the DOM), with --timeout ms.",
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

	if (options.command === "focus-app") {
		const focus = focusAcepeApp(options.appIdentifier);
		const result = buildResult({
			command: "focus-app",
			status: focus.ok ? "ok" : "fail",
			summary: [focus.message],
			error: focus.ok
				? undefined
				: dependencyError(
						"focus_app_failed",
						focus.message,
						"Start the Tauri dev app, then retry focus-app."
					),
		});
		return emitVerifiedUiResult(options, result);
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
			`sessionCanSubmit: ${observation.value.composer.sessionCanSubmit === null ? "unknown" : observation.value.composer.sessionCanSubmit.toString()}`,
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
				error: dependencyError(
					"missing_selector",
					"--selector is required.",
					"Example: bun run qa inspect --selector=.onboarding-preview-panel"
				),
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
			first === undefined
				? "first: none"
				: `first: ${first.tag} ${first.rect.width.toFixed(0)}x${first.rect.height.toFixed(0)} "${first.text.slice(0, 80)}"`,
			first === undefined
				? "value: none"
				: `value: ${first.value === null ? "none" : JSON.stringify(first.value)} focused=${first.focused ? "yes" : "no"}`,
			first?.src === undefined || first.src === null ? "src: none" : `src: ${first.src}`,
			first === undefined ? "attrs: none" : `attrs: ${formatAttributes(first.attributes)}`,
			first === undefined
				? "computed: none"
				: `computed: display=${first.computedStyle.display} gap=${first.computedStyle.gap} rowGap=${first.computedStyle.rowGap} columnGap=${first.computedStyle.columnGap}`,
			first === undefined
				? "padding: none"
				: `padding: top=${first.computedStyle.paddingTop} right=${first.computedStyle.paddingRight} bottom=${first.computedStyle.paddingBottom} left=${first.computedStyle.paddingLeft}`,
			first === undefined
				? "animation: none"
				: `animation: name=${first.computedStyle.animationName} duration=${first.computedStyle.animationDuration} delay=${first.computedStyle.animationDelay} iteration=${first.computedStyle.animationIterationCount}`,
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

	if (options.command === "planning-debug") {
		const debug = await readPlanningDebug({
			appIdentifier: options.appIdentifier,
			sessionId: options.sessionId.length === 0 ? null : options.sessionId,
			skipDriver: options.skipDriver,
		});
		if (debug.isErr()) {
			const result = buildResult({
				command: "planning-debug",
				status: "fail",
				summary: ["Unable to read planning-debug snapshots."],
				error: dependencyError(
					debug.error.code,
					debug.error.message,
					"Run acepe-qa doctor, then retry. The hook is installed once an agent panel mounts."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("planning-debug", debug.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const summary = debug.value.available
			? [
					`snapshots: ${debug.value.snapshots.length.toString()}`,
					...debug.value.snapshots.map(
						(snapshot) =>
							`- ${snapshot.sessionId ?? "null"} planning=${snapshot.showPlanningIndicator} | optimistic=${snapshot.hasOptimisticPendingEntry} pendingSend=${snapshot.hasLocalPendingSendIntent} activity=${snapshot.activityKind ?? "null"} turn=${snapshot.turnState ?? "null"} lifecycle=${snapshot.lifecycleStatus ?? "null"} source=${snapshot.sourceKind ?? "null"} canSend=${snapshot.actionabilityCanSend === null ? "null" : snapshot.actionabilityCanSend.toString()} canSubmit=${snapshot.sessionCanSubmit.toString()} disableSend=${snapshot.disableSendForFailedFirstSend.toString()} entries=${snapshot.visibleEntryCount.toString()}`
					),
				]
			: [
					"hook not installed (window.__acepePlanningSnapshot missing) — open an agent panel and retry",
				];
		const result = buildResult({
			command: "planning-debug",
			status: "ok",
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "planning-debug",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return statusExitCode(result.status);
	}

	if (options.command === "computer-probe") {
		const sessionId = options.sessionId.length === 0 ? "acepe-computer-use-qa" : options.sessionId;
		const probe = await probeComputerUse({
			appIdentifier: options.appIdentifier,
			sessionId,
			action: options.action,
			targetLabel: options.targetLabel,
			text: options.text,
			key: options.key,
			dx: options.dx,
			dy: options.dy,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "computer-probe",
				status: "fail",
				summary: ["Unable to invoke the Acepe computer-use probe."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor, then retry computer-probe against the dev app."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("computer-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const hasAction = probe.value.actionVerb !== null;
		const hasObservationFacts =
			probe.value.app !== null || probe.value.window !== null || probe.value.elementCount > 0;
		const actionChanged =
			probe.value.actionChangedCount !== null && probe.value.actionChangedCount > 0;
		const actionNeedsObservedChange = probe.value.actionVerb === "type";
		const actionSucceeded =
			hasAction && probe.value.actionOk === true && (!actionNeedsObservedChange || actionChanged);
		const observationSucceeded =
			!hasAction &&
			((probe.value.ok && hasObservationFacts) ||
				probe.value.errorCode === "computer_permission_required");
		const status = actionSucceeded || observationSucceeded ? "ok" : "warn";
		const baseSummary = [
			`server: ${probe.value.serverName}`,
			`tool: ${probe.value.toolName}`,
			`transport: ${probe.value.transport}`,
			`session: ${probe.value.sessionId}`,
			`ok: ${probe.value.ok ? "yes" : "no"}`,
			`isError: ${probe.value.isError ? "yes" : "no"}`,
			`app: ${probe.value.app ?? "none"}`,
			`window: ${probe.value.window ?? "none"}`,
			`elements: ${probe.value.elementCount.toString()}`,
			`observation facts: ${hasObservationFacts ? "present" : "empty"}`,
			`error: ${probe.value.errorCode ?? "none"}`,
			`permission: ${probe.value.permissionKind ?? "none"}`,
		];
		const actionSummary =
			probe.value.actionVerb === null
				? []
				: [
						`action: ${probe.value.actionVerb}`,
						`target label: ${probe.value.actionTargetLabel ?? "none"}`,
						`target id: ${probe.value.actionTargetId ?? "none"}`,
						`action ok: ${probe.value.actionOk === true ? "yes" : "no"}`,
						`action changed: ${probe.value.actionChangedCount === null ? "unknown" : probe.value.actionChangedCount.toString()}`,
						`action elements: ${probe.value.actionElementCount === null ? "unknown" : probe.value.actionElementCount.toString()}`,
						`action error: ${probe.value.actionErrorCode ?? "none"}`,
					];
		const result = buildResult({
			command: "computer-probe",
			status,
			summary: baseSummary.concat(actionSummary),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "computer-probe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "resize-probe") {
		const probe = await probePanelResize({
			appIdentifier: options.appIdentifier,
			dx: options.dx ?? 220,
			steps: Number.isFinite(options.limit) ? options.limit : 24,
			stepDelayMs: Number.isFinite(options.delayMs) ? options.delayMs : 16,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "resize-probe",
				status: "fail",
				summary: ["Unable to run the panel resize probe."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor, then retry resize-probe against the dev app."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("resize-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const observedDelta =
			probe.value.observedDeltaBeforeRestore === null
				? "unknown"
				: probe.value.observedDeltaBeforeRestore.toFixed(1);
		const finalLag =
			probe.value.finalLagPx === null ? "unknown" : probe.value.finalLagPx.toFixed(1);
		const frameLag =
			probe.value.maxFrameLagPx === null ? "unknown" : probe.value.maxFrameLagPx.toFixed(1);
		const frameDelay =
			probe.value.maxFrameDelayMs === null ? "unknown" : probe.value.maxFrameDelayMs.toFixed(1);
		const avgFrameDelay =
			probe.value.avgFrameDelayMs === null ? "unknown" : probe.value.avgFrameDelayMs.toFixed(1);
		const status =
			!probe.value.found ||
			(probe.value.maxFrameDelayMs !== null && probe.value.maxFrameDelayMs > 32)
				? "warn"
				: "ok";
		const result = buildResult({
			command: "resize-probe",
			status,
			summary: [
				`found: ${probe.value.found ? "yes" : "no"}`,
				`requested dx: ${probe.value.requestedDelta.toString()}px over ${probe.value.steps.toString()} steps`,
				`width: ${probe.value.originalWidth === null ? "unknown" : probe.value.originalWidth.toFixed(1)}px -> ${probe.value.finalWidthBeforeRestore === null ? "unknown" : probe.value.finalWidthBeforeRestore.toFixed(1)}px before restore`,
				`observed delta: ${observedDelta}px`,
				`final lag: ${finalLag}px`,
				`max frame lag: ${frameLag}px`,
				`frame delay: avg=${avgFrameDelay}ms max=${frameDelay}ms`,
				`transition: ${probe.value.transitionProperty ?? "unknown"} duration=${probe.value.transitionDuration ?? "unknown"}`,
				`restored width: ${probe.value.restoredWidth === null ? "unknown" : probe.value.restoredWidth.toFixed(1)}px`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "resize-probe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "resize-stream-probe") {
		const probe = await probePanelResizeStream({
			appIdentifier: options.appIdentifier,
			dx: options.dx ?? 220,
			durationMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 600,
			moveIntervalMs: Number.isFinite(options.delayMs) ? options.delayMs : 8,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "resize-stream-probe",
				status: "fail",
				summary: ["Unable to run the continuous panel resize probe."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor, then retry resize-stream-probe against the dev app."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("resize-stream-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const maxLag = probe.value.maxLagPx === null ? "unknown" : probe.value.maxLagPx.toFixed(1);
		const avgLag = probe.value.avgLagPx === null ? "unknown" : probe.value.avgLagPx.toFixed(1);
		const avgFrame =
			probe.value.avgFrameIntervalMs === null
				? "unknown"
				: probe.value.avgFrameIntervalMs.toFixed(1);
		const maxFrame =
			probe.value.maxFrameIntervalMs === null
				? "unknown"
				: probe.value.maxFrameIntervalMs.toFixed(1);
		const status =
			!probe.value.found || (probe.value.maxLagPx !== null && probe.value.maxLagPx > 24)
				? "warn"
				: "ok";
		const result = buildResult({
			command: "resize-stream-probe",
			status,
			summary: [
				`found: ${probe.value.found ? "yes" : "no"}`,
				`requested dx: ${probe.value.requestedDelta.toString()}px over ${probe.value.durationMs.toString()}ms`,
				`moves: ${probe.value.moveCount.toString()} every ${probe.value.moveIntervalMs.toString()}ms`,
				`frames: ${probe.value.frameCount.toString()} avg=${avgFrame}ms max=${maxFrame}ms over50=${probe.value.framesOver50Ms.toString()}`,
				`lag: avg=${avgLag}px max=${maxLag}px`,
				`width: ${probe.value.originalWidth === null ? "unknown" : probe.value.originalWidth.toFixed(1)}px -> ${probe.value.finalWidthBeforeRestore === null ? "unknown" : probe.value.finalWidthBeforeRestore.toFixed(1)}px before restore`,
				`transition: ${probe.value.transitionProperty ?? "unknown"} duration=${probe.value.transitionDuration ?? "unknown"}`,
				`restored width: ${probe.value.restoredWidth === null ? "unknown" : probe.value.restoredWidth.toFixed(1)}px`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "resize-stream-probe",
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
				error: dependencyError(
					"missing_target",
					"Click needs a selector or text.",
					"Example: bun run qa click --text='Reset Onboarding'"
				),
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
				error: dependencyError(
					click.error.code,
					click.error.message,
					"Run acepe-qa doctor, then retry click."
				),
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
				click.value.match === null
					? "match: none"
					: `match: ${click.value.match.tag} "${click.value.match.text.slice(0, 80)}"`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "click",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "navigate") {
		if (options.path.length === 0) {
			const result = buildResult({
				command: "navigate",
				status: "fail",
				summary: ["Missing --path."],
				error: dependencyError(
					"missing_path",
					"--path is required.",
					"Example: bun run qa navigate --path=/test-thinking-block"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const navigation = await navigateWebview({
			appIdentifier: options.appIdentifier,
			path: options.path,
			skipDriver: options.skipDriver,
		});
		if (navigation.isErr()) {
			const result = buildResult({
				command: "navigate",
				status: "fail",
				summary: ["Unable to navigate the Acepe WebView."],
				error: dependencyError(
					navigation.error.code,
					navigation.error.message,
					"Run acepe-qa doctor, then retry navigate."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("navigate", navigation.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "navigate",
			status: "ok",
			summary: [
				`from: ${navigation.value.from}`,
				`to: ${navigation.value.to}`,
				`path: ${navigation.value.path}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "navigate",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "reload") {
		const reload = await reloadWebview({
			appIdentifier: options.appIdentifier,
			skipDriver: options.skipDriver,
		});
		if (reload.isErr()) {
			const result = buildResult({
				command: "reload",
				status: "fail",
				summary: ["Unable to reload the Acepe WebView."],
				error: dependencyError(
					reload.error.code,
					reload.error.message,
					"Run acepe-qa doctor, then retry reload."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("reload", reload.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "reload",
			status: "ok",
			summary: [
				`from: ${reload.value.from}`,
				`path: ${reload.value.path}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "reload",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "thinking-toggle-probe") {
		const probe = await probeThinkingToggle({
			appIdentifier: options.appIdentifier,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "thinking-toggle-probe",
				status: "fail",
				summary: ["Unable to probe the thinking toggle."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor, then retry thinking-toggle-probe."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("thinking-toggle-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const summary = [
			`found: ${probe.value.found ? "yes" : "no"}`,
			`clicked: ${probe.value.clicked ? "yes" : "no"}`,
		].concat(
			probe.value.samples.map((sample) => {
				const content =
					sample.firstContentText === null ? "" : ` text="${sample.firstContentText.slice(0, 60)}"`;
				return `${sample.label}: expand=${sample.expandCount.toString()} collapse=${sample.collapseCount.toString()} content=${sample.contentCount.toString()} first=${sample.firstButtonName ?? "none"}${content}`;
			})
		);
		const result = buildResult({
			command: "thinking-toggle-probe",
			status: probe.value.samples.some(
				(sample) => sample.collapseCount > 0 && sample.contentCount > 0
			)
				? "ok"
				: "warn",
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "thinking-toggle-probe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "first-send-probe") {
		if (options.text.length === 0) {
			const result = buildResult({
				command: "first-send-probe",
				status: "fail",
				summary: ["Missing --text."],
				error: dependencyError(
					"missing_text",
					"first-send-probe needs --text.",
					"Example: bun run qa first-send-probe --text='QA ping: reply ok'"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const probe = await probeFirstSendTimeline({
			appIdentifier: options.appIdentifier,
			text: options.text,
			selector: options.selector,
			timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5_000,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "first-send-probe",
				status: "fail",
				summary: ["Unable to probe first-send timing."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor; ensure the target composer is visible."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("first-send-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const firstVisible = probe.value.samples.find((sample) => sample.messageVisible);
		const firstComposerEcho = probe.value.samples.find((sample) => sample.composerContainsPrompt);
		const firstPlanning = probe.value.samples.find((sample) => sample.planningVisible);
		const result = buildResult({
			command: "first-send-probe",
			status: probe.value.sent ? "ok" : "warn",
			summary: [
				`composer: ${probe.value.composerFound ? "found" : "missing"}`,
				`composer index: ${probe.value.selectedComposerIndex === null ? "none" : probe.value.selectedComposerIndex.toString()}`,
				`composer name: ${probe.value.selectedComposerName ?? "none"}`,
				`send: ${probe.value.sendFound ? "found" : "missing"}`,
				`send ready: ${probe.value.sendReadyBeforeClick ? "yes" : "no"}`,
				`sent: ${probe.value.sent ? "yes" : "no"}`,
				`composer echo: ${firstComposerEcho === undefined ? "never" : `${firstComposerEcho.elapsedMs.toString()}ms`}`,
				`transcript message visible: ${firstVisible === undefined ? "never" : `${firstVisible.elapsedMs.toString()}ms`}`,
				`planning visible: ${firstPlanning === undefined ? "never" : `${firstPlanning.elapsedMs.toString()}ms`}`,
				`samples: ${probe.value.samples.length.toString()}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "first-send-probe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "streaming-repro-lab") {
		const lab = await openStreamingReproLab({
			appIdentifier: options.appIdentifier,
			delayMs: Number.isFinite(options.delayMs) ? options.delayMs : 300,
			skipDriver: options.skipDriver,
		});
		if (lab.isErr()) {
			const result = buildResult({
				command: "streaming-repro-lab",
				status: "fail",
				summary: ["Unable to open the Streaming Repro Lab."],
				error: dependencyError(
					lab.error.code,
					lab.error.message,
					"Run acepe-qa doctor; ensure the dev app contains the streaming repro QA hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("streaming-repro-lab", lab.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "streaming-repro-lab",
			status: lab.value.hookAvailable && lab.value.opened && lab.value.labPresent ? "ok" : "warn",
			summary: [
				`hook: ${lab.value.hookAvailable ? "available" : "missing"}`,
				`opened: ${lab.value.opened ? "yes" : "no"}`,
				`lab: ${lab.value.labPresent ? "present" : "missing"}`,
				`phase: ${lab.value.phaseLabel ?? "none"}`,
				`token reveal mode: ${lab.value.tokenRevealMode ?? "none"}`,
				`animated token spans: ${lab.value.tokenRevealAnimatedCount.toString()}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "streaming-repro-lab",
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
				error: dependencyError(
					reset.error.code,
					reset.error.message,
					"Run acepe-qa doctor, then retry reset-onboarding."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("reset-onboarding", reset.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "reset-onboarding",
			status:
				reset.value.clickedDevTools && reset.value.clickedReset && reset.value.hasWelcome
					? "ok"
					: "warn",
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

	if (options.command === "send") {
		if (options.text.length === 0) {
			const result = buildResult({
				command: "send",
				status: "fail",
				summary: ["Missing --text."],
				error: dependencyError(
					"missing_text",
					"send needs --text.",
					"Example: bun run qa send --text='reply with one word: ok'"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const send = await sendComposer({
			appIdentifier: options.appIdentifier,
			text: options.text,
			selector: options.selector,
			submit: !options.noSubmit,
			skipDriver: options.skipDriver,
		});
		if (send.isErr()) {
			const result = buildResult({
				command: "send",
				status: "fail",
				summary: ["Unable to send via the composer."],
				error: dependencyError(
					send.error.code,
					send.error.message,
					"Run acepe-qa doctor; ensure a sendable session is open."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("send", send.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "send",
			status: send.value.sent ? "ok" : "warn",
			summary: [
				`composer: ${send.value.composerFound ? "found" : "missing"}`,
				`send ready: ${send.value.sendReady ? "yes" : "no"}`,
				`sent: ${send.value.sent ? "yes" : "no"}`,
				`text: "${send.value.textApplied.slice(0, 60)}"`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "send",
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "watch") {
		if (options.text.length === 0) {
			const result = buildResult({
				command: "watch",
				status: "fail",
				summary: ["Missing --text."],
				error: dependencyError(
					"missing_text",
					"watch needs --text.",
					"Example: bun run qa watch --text='Planning next moves' --timeout=20000"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const watch = await watchForVisibleText({
			appIdentifier: options.appIdentifier,
			text: options.text,
			timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20_000,
			skipDriver: options.skipDriver,
		});
		if (watch.isErr()) {
			const result = buildResult({
				command: "watch",
				status: "fail",
				summary: ["Unable to watch the Acepe WebView."],
				error: dependencyError(
					watch.error.code,
					watch.error.message,
					"Run acepe-qa doctor, then retry watch."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("watch", watch.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const m = watch.value.matched;
		const result = buildResult({
			command: "watch",
			// warn (not fail) when present-but-hidden: that's a real, reportable finding.
			status: watch.value.visible ? "ok" : "warn",
			summary: [
				`text: "${watch.value.text.slice(0, 60)}"`,
				`present in dom: ${watch.value.presentInDom ? "yes" : "no"}`,
				`visible: ${watch.value.visible ? "yes" : "no"}`,
				watch.value.firstVisibleAtMs === null
					? "first visible: never"
					: `first visible: ${watch.value.firstVisibleAtMs.toString()}ms`,
				`elapsed: ${watch.value.elapsedMs.toString()}ms${watch.value.timedOut ? " (timed out)" : ""}`,
				m === null
					? "matched: none"
					: `matched: ${m.rect.width.toFixed(0)}x${m.rect.height.toFixed(0)} display=${m.display} visibility=${m.visibility} opacity=${m.opacity} offsetParent=${m.hasOffsetParent ? "yes" : "no"}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "watch",
		});
		return emitVerifiedUiResult(options, result);
	}

	const result = buildResult({
		command: options.command,
		status: "fail",
		summary: ["Unknown command."],
		error: dependencyError(
			"unknown_command",
			options.command,
			"Use doctor, observe, screenshot, navigate, inspect, click, thinking-toggle-probe, streaming-repro-lab, send, watch, or reset-onboarding."
		),
	});
	process.stdout.write(formatCommandResult(result, options.format));
	return statusExitCode(result.status);
}
