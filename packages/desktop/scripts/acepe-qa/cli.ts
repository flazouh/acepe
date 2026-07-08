import { spawnSync } from "node:child_process";
import {
	agentPanelStressLabMeasurementWarnings,
	agentPanelStressLabStatus,
} from "./agent-panel-stress-lab-summary";
import { writeJsonArtifact } from "./artifacts";
import { writeUiQaEvidence } from "./evidence";
import { summarizeFirstSendProbe } from "./first-send-probe-summary";
import { frameRateProbeTimingValid, summarizeFrameRateProbe } from "./frame-rate-probe-summary";
import { probeUiPackageHmr } from "./hmr-ui-probe";
import {
	clickWebview,
	focusDevApp,
	hoverWebview,
	inspectDom,
	inspectShadowDom,
	navigateWebview,
	openAgentPanelStressLab,
	openStreamingReproLab,
	probeAgentPanelScrollPages,
	probeComputerUse,
	probeFrameRate,
	probeFirstSendTimeline,
	probeHappyPathPerformance,
	probeLedgerBackfill,
	probeSessionOpenContent,
	probePanelResize,
	probePanelResizeStream,
	probeThinkingToggle,
	readPlanningDebug,
	reloadWebview,
	resetOnboarding,
	scanAgentPanelRows,
	sendComposer,
	watchForVisibleText,
} from "./interact";
import { observeApp, screenshotApp } from "./observe";
import {
	buildResult,
	dependencyError,
	formatCommandResult,
	type OutputFormat,
	statusExitCode,
} from "./output";
import { runDoctor } from "./process-target";
import { summarizeSessionOpenContentProbe } from "./session-open-probe-summary";
import {
	type DomInspectionResult,
	type FocusAppResult,
	type HappyPathPerformanceResult,
	type SessionOpenContentProbeResult,
	type TauriPendingInvokeRecord,
	type TargetProcess,
	observeLevelSchema,
} from "./schemas";

type CliOptions = {
	readonly command: string;
	readonly appIdentifier: string;
	readonly checkoutRoot: string;
	readonly format: OutputFormat;
	readonly level: "summary" | "focused" | "raw";
	readonly selector: string;
	readonly selectorIndex: number;
	readonly hostSelector: string;
	readonly afterSelector: string;
	readonly text: string;
	readonly action: string;
	readonly targetLabel: string;
	readonly key: string;
	readonly dx: number | null;
	readonly dy: number | null;
	readonly sessionId: string;
	readonly projectPath: string;
	readonly agentId: string;
	readonly sourcePath: string;
	readonly title: string;
	readonly path: string;
	readonly limit: number;
	readonly delayMs: number;
	readonly settleMs: number;
	readonly timeoutMs: number;
	readonly rows: number;
	readonly preset: string;
	readonly rendererMode: string;
	readonly seed: number;
	readonly scrollStepPx: number | null;
	readonly noSubmit: boolean;
	readonly noScrollSample: boolean;
	readonly noStreamingTail: boolean;
	readonly keepOpen: boolean;
	readonly withRowChurn: boolean;
	readonly withProfile: boolean;
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

function formatDomInspectionSummary(inspection: DomInspectionResult): string[] {
	const first = inspection.elements[0];
	return [
		`selector: ${inspection.selector}`,
		`matches: ${inspection.count.toString()}`,
		`returned: ${inspection.elements.length.toString()}`,
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
			: `computed: display=${first.computedStyle.display} color=${first.computedStyle.color} bg=${first.computedStyle.backgroundColor} gap=${first.computedStyle.gap} rowGap=${first.computedStyle.rowGap} columnGap=${first.computedStyle.columnGap}`,
		first === undefined
			? "padding: none"
			: `padding: top=${first.computedStyle.paddingTop} right=${first.computedStyle.paddingRight} bottom=${first.computedStyle.paddingBottom} left=${first.computedStyle.paddingLeft}`,
		first === undefined
			? "animation: none"
			: `animation: name=${first.computedStyle.animationName} duration=${first.computedStyle.animationDuration} delay=${first.computedStyle.animationDelay} iteration=${first.computedStyle.animationIterationCount}`,
	];
}

function formatOptionalMs(value: number | null): string {
	if (value === null || !Number.isFinite(value)) {
		return "unavailable";
	}
	return `${value.toFixed(2)} ms`;
}

function formatOptionalCount(value: number | null): string {
	if (value === null || !Number.isFinite(value)) {
		return "unavailable";
	}
	return value.toString();
}

function formatPanelOpenMarks(marks: Readonly<Record<string, number>>): string {
	const entries = Object.entries(marks);
	if (entries.length === 0) {
		return "unavailable";
	}
	return entries.map(([name, value]) => `${name}=${formatOptionalMs(value)}`).join(", ");
}

function formatAgentPanelPerformanceTopList(
	samples: readonly SessionOpenContentProbeResult["agentPanelPerformanceSamples"][number][],
	limit: number
): string {
	const topSamples = samples
		.filter((sample) => Number.isFinite(sample.durationMs) && sample.durationMs > 0)
		.toSorted((left, right) => right.durationMs - left.durationMs)
		.slice(0, limit);
	if (topSamples.length === 0) {
		return "unavailable";
	}
	return topSamples
		.map((sample) =>
			[
				`${sample.phase}=${formatOptionalMs(sample.durationMs)}`,
				`items=${sample.itemCount === null ? "unknown" : sample.itemCount.toString()}`,
				`nodes=${sample.nodeCount === null ? "unknown" : sample.nodeCount.toString()}`,
			].join("/")
		)
		.join(", ");
}

function formatTraceName(name: string): string {
	return name.startsWith("background:") ? name.slice("background:".length) : name;
}

function formatStartupTraceSummary(result: HappyPathPerformanceResult): string[] {
	const initializeStep = result.app.startupTrace.find((entry) => entry.name === "initialize");
	const initializeCompletedAtMs = initializeStep?.completedAtMs ?? null;
	const blockingEntries = result.app.startupTrace.filter((entry) => {
		if (
			entry.durationMs === null ||
			entry.name === "initialize" ||
			entry.name.startsWith("background:")
		) {
			return false;
		}
		if (initializeCompletedAtMs === null || entry.completedAtMs === null) {
			return false;
		}
		return entry.completedAtMs <= initializeCompletedAtMs;
	});
	const backgroundEntries = result.app.startupTrace.filter((entry) => {
		if (entry.name === "initialize") {
			return false;
		}
		if (entry.name.startsWith("background:")) {
			return true;
		}
		if (initializeCompletedAtMs === null) {
			return false;
		}
		if (entry.completedAtMs === null) {
			return entry.startedAtMs <= initializeCompletedAtMs;
		}
		return entry.completedAtMs > initializeCompletedAtMs;
	});

	const completedBlocking = blockingEntries
		.filter((entry) => entry.durationMs !== null)
		.sort((left, right) => (right.durationMs ?? -1) - (left.durationMs ?? -1))
		.slice(0, 5);
	const completedBackground = backgroundEntries
		.filter((entry) => entry.durationMs !== null)
		.sort((left, right) => (right.durationMs ?? -1) - (left.durationMs ?? -1))
		.slice(0, 3);
	const pendingBackground = backgroundEntries
		.filter((entry) => entry.durationMs === null)
		.map((entry) => entry.name)
		.slice(0, 3);

	if (completedBlocking.length === 0) {
		return ["startup trace blocking: unavailable"];
	}
	const blocking = completedBlocking
		.map((entry) => `${formatTraceName(entry.name)}=${formatOptionalMs(entry.durationMs)}`)
		.join(", ");
	const backgroundParts = completedBackground.map(
		(entry) => `${formatTraceName(entry.name)}=${formatOptionalMs(entry.durationMs)}`
	);
	const pendingParts = pendingBackground.map((name) => `${formatTraceName(name)}=pending`);
	const background = backgroundParts.concat(pendingParts).join(", ");
	return background.length === 0
		? [`startup trace blocking: ${blocking}`]
		: [`startup trace blocking: ${blocking}`, `startup trace background: ${background}`];
}

function formatPanelCloseTraceSummary(result: HappyPathPerformanceResult): string[] {
	const trace = result.openClose.closeTrace;
	if (trace === null) {
		return ["panel close trace: unavailable"];
	}
	return [
		`panel close trace: call=${formatOptionalMs(result.openClose.closeCallReturnMs)} store=${formatOptionalMs(trace.totalMs)} remove=${formatOptionalMs(trace.removePanelMs)} hot=${formatOptionalMs(trace.hotStateCleanupMs)} files=${formatOptionalMs(trace.fileOwnershipCleanupMs)} terminals=${formatOptionalMs(trace.embeddedTerminalCleanupMs)} persist=${formatOptionalMs(trace.persistMs)}`,
	];
}

function formatProjectLoadTraceSummary(result: HappyPathPerformanceResult): string[] {
	const trace = result.app.projectLoadTrace;
	if (trace === null) {
		return ["project load trace: unavailable"];
	}
	return [
		`project load trace: total=${formatOptionalMs(trace.totalMs)} count=${formatOptionalMs(trace.getProjectCountMs)} projects=${formatOptionalMs(trace.getProjectsMs)} assign=${formatOptionalMs(trace.assignStateMs)} rows=${trace.projectCount.toString()}`,
	];
}

type TauriInvokeTiming = HappyPathPerformanceResult["app"]["tauriInvokeTimings"][number];
type SessionOpenTauriInvokeTiming = SessionOpenContentProbeResult["tauriInvokeTimings"][number];
type SessionOpenHydrationTiming = SessionOpenContentProbeResult["hydrationTimings"][number];

function sumInvokeDurations(records: readonly TauriInvokeTiming[]): number {
	let totalMs = 0;
	for (const record of records) {
		totalMs += record.durationMs;
	}
	return totalMs;
}

function countInvokeErrors(records: readonly TauriInvokeTiming[]): number {
	let count = 0;
	for (const record of records) {
		if (record.status === "error") {
			count += 1;
		}
	}
	return count;
}

function formatInvokeTopList(records: readonly TauriInvokeTiming[], limit: number): string {
	const sortedRecords = records
		.slice()
		.sort((left, right) => right.durationMs - left.durationMs)
		.slice(0, limit);
	if (sortedRecords.length === 0) {
		return "none";
	}
	return sortedRecords
		.map((record) => {
			const argsLabel = record.argsSummary === null ? "" : `[${record.argsSummary}]`;
			return `${record.command}${argsLabel}=${formatOptionalMs(record.durationMs)}`;
		})
		.join(", ");
}

function formatSessionOpenInvokeTopList(
	records: readonly SessionOpenTauriInvokeTiming[],
	limit: number
): string {
	const sortedRecords = records
		.slice()
		.sort((left, right) => right.durationMs - left.durationMs)
		.slice(0, limit);
	if (sortedRecords.length === 0) {
		return "none";
	}
	return sortedRecords
		.map((record) => {
			const argsLabel = record.argsSummary === null ? "" : `[${record.argsSummary}]`;
			return `${record.command}${argsLabel}=${formatOptionalMs(record.durationMs)}`;
		})
		.join(", ");
}

function formatPendingInvokeTopList(
	records: readonly TauriPendingInvokeRecord[],
	limit: number
): string {
	const sortedRecords = records
		.slice()
		.sort((left, right) => right.elapsedMs - left.elapsedMs)
		.slice(0, limit);
	if (sortedRecords.length === 0) {
		return "none";
	}
	return sortedRecords
		.map((record) => {
			const argsLabel = record.argsSummary === null ? "" : `[${record.argsSummary}]`;
			return `${record.command}${argsLabel}=pending ${formatOptionalMs(record.elapsedMs)}`;
		})
		.join(", ");
}

function formatHydrationTimingTopList(
	records: readonly SessionOpenHydrationTiming[],
	limit: number
): string {
	const sortedRecords = records
		.slice()
		.sort((left, right) => right.totalMs - left.totalMs)
		.slice(0, limit);
	if (sortedRecords.length === 0) {
		return "none";
	}
	return sortedRecords
		.map((record) =>
			[
				`total=${formatOptionalMs(record.totalMs)}`,
				`materialize=${formatOptionalMs(record.materializeSnapshotMs)}`,
				`replaceOpen=${formatOptionalMs(record.replaceOpenSnapshotMs)}`,
				`replaceGraph=${formatOptionalMs(record.replaceStateGraphMs)}`,
				`viewport=${formatOptionalMs(record.applyViewportEnvelopeMs)}`,
				`page=${formatOptionalMs(record.applyInitialRowPageMs)}`,
				`bootstrap=${formatOptionalMs(record.ensureRowsBootstrapMs)}`,
				`panel=${formatOptionalMs(record.updatePanelSessionMs)}`,
				`rows=${record.initialRowPageRowCount === null ? "unknown" : record.initialRowPageRowCount.toString()}`,
				`bytes=${record.rowPayloadBytes === null ? "unknown" : record.rowPayloadBytes.toString()}`,
			].join(" ")
		)
		.join(", ");
}

function formatSessionOpenEvents(
	events: readonly SessionOpenContentProbeResult["openEvents"][number][],
	limit: number
): string {
	const visibleEvents = events.slice(-limit);
	if (visibleEvents.length === 0) {
		return "none";
	}
	return visibleEvents
		.map((event) => {
			const outcomeLabel = event.outcome === null ? "" : `/${event.outcome}`;
			const canonicalLabel =
				event.canonicalSessionId === null ? "" : `:${event.canonicalSessionId.slice(0, 8)}`;
			const messageLabel = event.message === null ? "" : `(${event.message.slice(0, 48)})`;
			const viewportLabel = event.hasInitialViewportEnvelope === true ? "+viewport" : "";
			return `${event.stage}${outcomeLabel}${canonicalLabel}${viewportLabel}@${formatOptionalMs(event.elapsedMs)}${messageLabel}`;
		})
		.join(", ");
}

function formatTauriInvokeSummary(result: HappyPathPerformanceResult): string[] {
	const timings = result.app.tauriInvokeTimings;
	if (timings.length === 0) {
		return ["tauri startup invokes: unavailable"];
	}

	const initializeStep = result.app.startupTrace.find((entry) => entry.name === "initialize");
	const initializeCompletedAtMs = initializeStep?.completedAtMs ?? null;
	const startupTimings =
		initializeCompletedAtMs === null
			? timings
			: timings.filter((record) => record.completedAtMs <= initializeCompletedAtMs);
	const overlappingTimings =
		initializeCompletedAtMs === null
			? []
			: timings.filter(
					(record) =>
						record.startedAtMs <= initializeCompletedAtMs &&
						record.completedAtMs > initializeCompletedAtMs
				);
	const totalErrors = countInvokeErrors(timings);
	const lines = [
		`tauri startup invokes: count=${startupTimings.length.toString()} sum=${formatOptionalMs(sumInvokeDurations(startupTimings))} top=${formatInvokeTopList(startupTimings, 6)}`,
		`tauri all invokes by probe: count=${timings.length.toString()} errors=${totalErrors.toString()} sum=${formatOptionalMs(sumInvokeDurations(timings))}`,
	];
	if (overlappingTimings.length > 0) {
		lines.push(
			`tauri overlap after init: count=${overlappingTimings.length.toString()} top=${formatInvokeTopList(overlappingTimings, 4)}`
		);
	}
	return lines;
}

export function parseOptions(args: readonly string[], checkoutRoot: string): CliOptions {
	if (hasArg(args, "--help") || hasArg(args, "-h")) {
		return {
			command: "help",
			appIdentifier: "9223",
			checkoutRoot,
			format: "text",
			level: "summary",
			selector: "",
			selectorIndex: 0,
			hostSelector: "",
			afterSelector: "",
			text: "",
			action: "",
			targetLabel: "",
			key: "",
			dx: null,
			dy: null,
			sessionId: "",
			projectPath: "",
			agentId: "",
			sourcePath: "",
			title: "",
			path: "",
			limit: 10,
			delayMs: 300,
			settleMs: 300,
			timeoutMs: 20_000,
			rows: 1_000,
			preset: "mixed",
			rendererMode: "full",
			seed: 1,
			scrollStepPx: null,
			noSubmit: false,
			noScrollSample: false,
			noStreamingTail: false,
			keepOpen: false,
			withRowChurn: false,
			withProfile: false,
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
		selectorIndex: Math.max(0, numberArg(args, "--selector-index") ?? 0),
		hostSelector: valueArg(args, "--host-selector", ""),
		afterSelector: valueArg(args, "--after-selector", ""),
		text: valueArg(args, "--text", ""),
		action: valueArg(args, "--action", ""),
		targetLabel: valueArg(args, "--target-label", ""),
		key: valueArg(args, "--key", ""),
		dx: numberArg(args, "--dx"),
		dy: numberArg(args, "--dy"),
		sessionId: valueArg(args, "--session-id", ""),
		projectPath: valueArg(args, "--project-path", ""),
		agentId: valueArg(args, "--agent-id", ""),
		sourcePath: valueArg(args, "--source-path", ""),
		title: valueArg(args, "--title", ""),
		path: valueArg(args, "--path", ""),
		limit: Number.parseInt(valueArg(args, "--limit", "10"), 10),
		delayMs: Number.parseInt(valueArg(args, "--delay", valueArg(args, "--delay-ms", "300")), 10),
		settleMs: Number.parseInt(
			valueArg(args, "--settle-ms", valueArg(args, "--delay", valueArg(args, "--delay-ms", "300"))),
			10
		),
		timeoutMs: Number.parseInt(valueArg(args, "--timeout", "20000"), 10),
		rows: Number.parseInt(valueArg(args, "--rows", "1000"), 10),
		preset: valueArg(args, "--preset", "mixed"),
		rendererMode: valueArg(args, "--renderer-mode", "full"),
		seed: Number.parseInt(valueArg(args, "--seed", "1"), 10),
		scrollStepPx: numberArg(args, "--scroll-step-px"),
		noSubmit: hasArg(args, "--no-submit"),
		noScrollSample: hasArg(args, "--no-scroll-sample"),
		noStreamingTail: hasArg(args, "--no-streaming-tail"),
		keepOpen: hasArg(args, "--keep-open"),
		withRowChurn: hasArg(args, "--with-row-churn"),
		withProfile: hasArg(args, "--with-profile"),
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

function uniqueProcessIds(
	appIdentifier: string,
	devProcesses: readonly TargetProcess[]
): readonly string[] {
	const ids: string[] = [];
	const bridgePid = bridgeProcessId(appIdentifier);
	if (bridgePid.length > 0) {
		ids.push(bridgePid);
	}
	for (const process of devProcesses) {
		const pid = process.pid.toString();
		if (!ids.includes(pid)) {
			ids.push(pid);
		}
	}
	return ids;
}

function appleScriptIntegerList(values: readonly string[]): string {
	if (values.length === 0) {
		return "{}";
	}
	return `{${values.join(", ")}}`;
}

function focusAcepeApp(
	appIdentifier: string,
	devProcesses: readonly TargetProcess[]
): {
	readonly ok: boolean;
	readonly message: string;
} {
	if (process.platform !== "darwin") {
		return {
			ok: false,
			message: "focus-app is currently implemented for macOS only.",
		};
	}
	const processIds = uniqueProcessIds(appIdentifier, devProcesses);
	const shouldActivateDevBundle = devProcesses.some((process) =>
		process.command.includes("Acepe Dev QA.app")
	);
	const devActivate = shouldActivateDevBundle
		? spawnSync("open", ["-b", "com.acepe.devqa"], {
				encoding: "utf8",
			})
		: null;
	const activateMessage =
		devActivate === null
			? "using bridge process focus"
			: devActivate.status === 0
				? "activated dev bundle com.acepe.devqa"
				: "dev bundle activation failed";
	const script = [
		'tell application "System Events"',
		"  set targetProcess to missing value",
		"  set targetFallbackProcess to missing value",
		'  set targetReason to "none"',
		processIds.length > 0
			? [
					`  set candidatePids to ${appleScriptIntegerList(processIds)}`,
					"  repeat with candidatePid in candidatePids",
					"    repeat with candidate in every process",
					"      if unix id of candidate is (candidatePid as integer) then",
					"        if targetFallbackProcess is missing value then",
					"          set targetFallbackProcess to candidate",
					'          set targetReason to "dev pid"',
					"        end if",
					"        if (count of windows of candidate) > 0 then",
					"          set targetProcess to candidate",
					'          set targetReason to "dev pid with window"',
					"          exit repeat",
					"        end if",
					"      end if",
					"    end repeat",
					"    if targetProcess is not missing value then exit repeat",
					"  end repeat",
				].join("\n")
			: "",
		"  set needsFallback to false",
		"  if targetProcess is missing value then",
		"    set needsFallback to true",
		"  else if (count of windows of targetProcess) is 0 then",
		"    set needsFallback to true",
		"  end if",
		"  if needsFallback then",
		"    repeat with candidate in every process",
		'      set candidateBundle to ""',
		"      try",
		"        set candidateBundle to bundle identifier of candidate as text",
		"      end try",
		'      if candidateBundle is "com.acepe.devqa" and (count of windows of candidate) > 0 then',
		"        set targetProcess to candidate",
		'        set targetReason to "dev bundle with window"',
		"        exit repeat",
		"      end if",
		"    end repeat",
		"  end if",
		"  if targetProcess is missing value and targetFallbackProcess is not missing value then",
		"    set targetProcess to targetFallbackProcess",
		"  end if",
		"  if targetProcess is missing value or (count of windows of targetProcess) is 0 then",
		"    repeat with candidate in every process",
		"      set candidateName to name of candidate as text",
		'      if candidateName is "Acepe Dev QA" and (count of windows of candidate) > 0 then',
		"        set targetProcess to candidate",
		'        set targetReason to "dev name with window"',
		"        exit repeat",
		"      end if",
		"    end repeat",
		"  end if",
		'  if targetProcess is missing value then error "Acepe dev process not found"',
		"  try",
		'    set value of attribute "AXFrontmost" of targetProcess to true',
		"  end try",
		"  if (count of windows of targetProcess) > 0 then",
		"    try",
		'    perform action "AXRaise" of window 1 of targetProcess',
		"    end try",
		"  end if",
		"  set frontmost of targetProcess to true",
		"  delay 0.2",
		'  if frontmost of targetProcess is false then error "Acepe process did not become frontmost"',
		'  return targetReason & " pid=" & ((unix id of targetProcess) as text) & " windows=" & ((count of windows of targetProcess) as text)',
		"end tell",
	]
		.filter((line) => line.length > 0)
		.join("\n");
	const result = spawnSync("osascript", ["-e", script], {
		encoding: "utf8",
	});
	if (result.status === 0) {
		const focusDetail = result.stdout.trim();
		return {
			ok: true,
			message: `${activateMessage}; focused ${focusDetail.length > 0 ? focusDetail : "Acepe dev app"}.`,
		};
	}
	return {
		ok: false,
		message: `${activateMessage}; ${result.stderr.trim() || result.stdout.trim() || "Unable to focus Acepe app."}`,
	};
}

function focusAppSummary(focus: FocusAppResult): string[] {
	const visibility = focus.documentVisibilityState ?? "unknown";
	const hasFocus =
		focus.documentHasFocus === null ? "unknown" : focus.documentHasFocus ? "yes" : "no";
	const windowVisible =
		focus.windowVisible === null ? "unknown" : focus.windowVisible ? "yes" : "no";
	const windowMinimized =
		focus.windowMinimized === null ? "unknown" : focus.windowMinimized ? "yes" : "no";
	const windowFocused =
		focus.windowFocused === null ? "unknown" : focus.windowFocused ? "yes" : "no";
	const windowSize =
		focus.windowOuterWidth === null || focus.windowOuterHeight === null
			? "unknown"
			: `${focus.windowOuterWidth.toString()}x${focus.windowOuterHeight.toString()}`;
	const summary = [
		focus.message,
		`webview: route=${focus.route ?? "unknown"} visibility=${visibility} focus=${hasFocus}`,
		`window: visible=${windowVisible} minimized=${windowMinimized} focused=${windowFocused} outer=${windowSize}`,
		`tauri activate: ${focus.tauriActivateAttempted ? (focus.tauriActivateOk ? "ok" : "failed") : "unavailable"}`,
		`window raise: ${focus.windowRaiseAttempted ? (focus.windowRaiseOk ? "ok" : "failed") : "unavailable"}`,
		`window focus: ${focus.windowFocusAttempted ? (focus.windowFocusOk ? "ok" : "failed") : "unavailable"}`,
	];
	if (focus.windowStateError !== null) {
		summary.push(`window state error: ${focus.windowStateError}`);
	}
	if (focus.tauriActivateError !== null) {
		summary.push(`tauri activate error: ${focus.tauriActivateError}`);
	}
	if (focus.windowFocusError !== null) {
		summary.push(`window focus error: ${focus.windowFocusError}`);
	}
	if (focus.windowRaiseError !== null) {
		summary.push(`window raise error: ${focus.windowRaiseError}`);
	}
	if (visibility !== "visible" || focus.documentHasFocus !== true) {
		summary.push("foreground frame probes remain invalid until visibility=visible and focus=yes");
	}
	return summary;
}

function focusAppIsForeground(focus: FocusAppResult): boolean {
	return focus.documentVisibilityState === "visible" && focus.documentHasFocus === true;
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
				"usage: bun run qa [doctor|focus-app|frame-rate-probe|agent-panel-row-scan|agent-panel-scroll-page-probe|ledger-backfill-probe|observe|screenshot|navigate|reload|inspect|inspect-shadow|click|hover|computer-probe|resize-probe|resize-stream-probe|thinking-toggle-probe|first-send-probe|session-open-content-probe|happy-path-perf|streaming-repro-lab|agent-panel-stress-lab|hmr-ui-probe|send|watch|reset-onboarding] [--app=9223] [--format=json]",
				"doctor checks the real dev Tauri target before QA.",
				"focus-app brings the Acepe desktop app to the macOS foreground.",
				"frame-rate-probe samples requestAnimationFrame cadence; add --selector to scroll an element while sampling, --scroll-step-px for fixed per-frame scroll speed, --with-row-churn for row mount diagnostics, and --with-profile for agent-panel render phase samples.",
				"agent-panel-row-scan scans the active transcript scroller for rows, scroll range, blank rows, and generic Tool labels; use --selector-index when multiple panels match.",
				"agent-panel-scroll-page-probe scrolls upward through the active transcript scroller and checks page traversal, frame timing, blank rows, and generic Tool labels; tune with --settle-ms and --selector-index.",
				"ledger-backfill-probe invokes warm_recent_transcript_row_ledgers inside the dev WebView and reports bounded rebuild counters.",
				"observe returns compact app facts before screenshots.",
				"screenshot captures the current WebView.",
				"navigate opens an app route with --path=/some-route.",
				"reload refreshes the current WebView route.",
				"inspect returns compact DOM facts for --selector.",
				"inspect-shadow returns compact DOM facts inside shadow DOM with --host-selector and --selector.",
				"click clicks by --selector or --text; add --key=Enter to activate focused controls after clicking.",
				"hover hovers by --selector or --text; add --after-selector to inspect immediately after hover.",
				"computer-probe invokes the real app's acepe_computer.act MCP path; add --action and --target-label to act.",
				"resize-probe drags the first panel resize edge and reports frame-by-frame width lag; tune with --dx, --limit steps, --delay ms.",
				"resize-stream-probe streams pointer moves over --timeout ms and reports continuous-drag lag.",
				"thinking-toggle-probe clicks the first thinking block and samples open/closed state over 500ms.",
				"first-send-probe types into the first composer, clicks send, and samples optimistic/planning visibility.",
				"session-open-content-probe opens --session-id and reports panel, transcript viewport, and first row paint timing; use --keep-open to inspect failures.",
				"happy-path-perf measures app timing plus temporary agent panel open/composer-ready/close timing.",
				"streaming-repro-lab opens the dev Streaming Repro Lab and samples native token reveal DOM.",
				"agent-panel-stress-lab opens the Agent Panel Stress Lab and samples render/scroll metrics; tune with --rows, --preset, --renderer-mode, --seed.",
				"hmr-ui-probe edits a @acepe/ui Svelte file and asserts Vite emits a single canonical HMR path (requires running dev server; restart after vite.config alias changes).",
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
			`frontend: ${doctor.value.frontendFreshness.status}`,
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
		const doctor = await runDoctor({
			checkoutRoot: options.checkoutRoot,
			appIdentifier: options.appIdentifier,
		});
		const focusAppIdentifier = doctor.isOk() ? doctor.value.appIdentifier : options.appIdentifier;
		const devProcesses = doctor.isOk() ? doctor.value.devProcesses : [];
		const targetSummary =
			doctor.isOk() && focusAppIdentifier !== options.appIdentifier
				? [`resolved active bridge: ${focusAppIdentifier}`]
				: [];
		const webviewFocus = await focusDevApp({
			appIdentifier: focusAppIdentifier,
			skipDriver: options.skipDriver,
		});
		if (webviewFocus.isOk()) {
			if (focusAppIsForeground(webviewFocus.value)) {
				const result = buildResult({
					command: "focus-app",
					status: "ok",
					summary: targetSummary.concat(focusAppSummary(webviewFocus.value)),
				});
				return emitVerifiedUiResult(options, result);
			}
			const focus = focusAcepeApp(focusAppIdentifier, devProcesses);
			if (focus.ok) {
				const retryWebviewFocus = await focusDevApp({
					appIdentifier: focusAppIdentifier,
					skipDriver: options.skipDriver,
				});
				if (retryWebviewFocus.isOk()) {
					const focused = focusAppIsForeground(retryWebviewFocus.value);
					const result = buildResult({
						command: "focus-app",
						status: focused ? "ok" : "warn",
						summary: targetSummary
							.concat([
								"initial webview focus was not foreground.",
								`accessibility fallback: ${focus.message}`,
							])
							.concat(focusAppSummary(retryWebviewFocus.value)),
					});
					return emitVerifiedUiResult(options, result);
				}
				const result = buildResult({
					command: "focus-app",
					status: "warn",
					summary: targetSummary
						.concat(focusAppSummary(webviewFocus.value))
						.concat(
							`accessibility fallback: ${focus.message}`,
							`retry webview focus failed: ${retryWebviewFocus.error.message}`
						),
				});
				return emitVerifiedUiResult(options, result);
			}
			const result = buildResult({
				command: "focus-app",
				status: "warn",
				summary: targetSummary
					.concat(focusAppSummary(webviewFocus.value))
					.concat(`accessibility fallback: ${focus.message}`),
			});
			return emitVerifiedUiResult(options, result);
		}

		const focus = focusAcepeApp(focusAppIdentifier, devProcesses);
		const result = buildResult({
			command: "focus-app",
			status: focus.ok ? "ok" : "fail",
			summary: targetSummary.concat([
				`webview focus failed: ${webviewFocus.error.message}`,
				`accessibility fallback: ${focus.message}`,
			]),
			error: focus.ok
				? undefined
				: dependencyError(
						"focus_app_failed",
						focus.message,
						"Run acepe-qa doctor; if the WebView is responsive but focus still fails, foreground-only FPS probes are blocked."
					),
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "frame-rate-probe" || options.command === "fps-probe") {
		const sampleCount = Number.isFinite(options.limit) ? options.limit : 120;
		const probe = await probeFrameRate({
			appIdentifier: options.appIdentifier,
			sampleCount,
			selector: options.selector,
			selectorIndex: options.selectorIndex,
			collectRowChurn: options.withRowChurn,
			collectAgentPanelProfile: options.withProfile,
			scrollStepPx: options.scrollStepPx,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "frame-rate-probe",
				status: "fail",
				summary: ["Unable to sample WebView frame rate."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor, focus-app, then retry frame-rate-probe."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("frame-rate-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "frame-rate-probe",
			status: frameRateProbeTimingValid(probe.value) ? "ok" : "warn",
			summary: summarizeFrameRateProbe(probe.value, {
				scrollStepPx: options.scrollStepPx,
			}),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "frame-rate-probe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "agent-panel-row-scan") {
		const selector =
			options.selector.length > 0
				? options.selector
				: '[data-testid="agent-panel-host"] .message-scroller__viewport';
		const scan = await scanAgentPanelRows({
			appIdentifier: options.appIdentifier,
			selector,
			selectorIndex: options.selectorIndex,
			limit: Number.isFinite(options.limit) ? options.limit : 10,
			skipDriver: options.skipDriver,
		});
		if (scan.isErr()) {
			const result = buildResult({
				command: "agent-panel-row-scan",
				status: "fail",
				summary: ["Unable to scan the active agent panel rows."],
				error: dependencyError(
					scan.error.code,
					scan.error.message,
					"Run acepe-qa doctor, open a session panel, then retry agent-panel-row-scan."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("agent-panel-row-scan", scan.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const rowSamples = scan.value.rows.slice(0, 5).map((row) => {
			const rowIndex = row.rowIndex === null ? "unknown" : row.rowIndex.toString();
			const visual =
				row.entryType === "tool_call"
					? `${row.entryType}/${row.toolKind ?? "unknown"}/${row.toolPresentationState ?? "none"}`
					: (row.entryType ?? "unknown");
			return `row ${row.index.toString()} idx=${rowIndex} h=${row.heightPx.toFixed(0)} ${visual} "${row.text.slice(0, 80)}"`;
		});
		const result = buildResult({
			command: "agent-panel-row-scan",
			status:
				scan.value.selectorMatched &&
				scan.value.rowCount > 0 &&
				scan.value.exactGenericToolRowCount === 0 &&
				scan.value.prefixGenericToolRowCount === 0 &&
				scan.value.rawProviderToolRowCount === 0 &&
				scan.value.missingEntryRowCount === 0 &&
				scan.value.degradedToolRowCount === 0 &&
				scan.value.emptyRowCount === 0
					? "ok"
					: "warn",
			summary: [
				`route: ${scan.value.route ?? "unknown"}`,
				`selector: ${scan.value.selector} index=${scan.value.selectorIndex.toString()}/${scan.value.selectorMatchCount.toString()} matched=${scan.value.selectorMatched ? "yes" : "no"}`,
				`rows: count=${scan.value.rowCount.toString()} first=${scan.value.firstRowIndex === null ? "unknown" : scan.value.firstRowIndex.toString()} last=${scan.value.lastRowIndex === null ? "unknown" : scan.value.lastRowIndex.toString()} empty=${scan.value.emptyRowCount.toString()}`,
				`scroll: top=${scan.value.scrollTopPx === null ? "unavailable" : scan.value.scrollTopPx.toFixed(0)} client=${scan.value.clientHeightPx === null ? "unavailable" : scan.value.clientHeightPx.toFixed(0)} height=${scan.value.scrollHeightPx === null ? "unavailable" : scan.value.scrollHeightPx.toFixed(0)} max=${scan.value.maxScrollTopPx === null ? "unavailable" : scan.value.maxScrollTopPx.toFixed(0)}`,
				`tool label leaks: genericExact=${scan.value.exactGenericToolRowCount.toString()} genericPrefix=${scan.value.prefixGenericToolRowCount.toString()} rawProvider=${scan.value.rawProviderToolRowCount.toString()}`,
				`visual state leaks: missing=${scan.value.missingEntryRowCount.toString()} degraded=${scan.value.degradedToolRowCount.toString()}`,
			].concat(rowSamples),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "agent-panel-row-scan",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "agent-panel-scroll-page-probe") {
		const selector =
			options.selector.length > 0
				? options.selector
				: '[data-testid="agent-panel-host"] .message-scroller__viewport';
		const probe = await probeAgentPanelScrollPages({
			appIdentifier: options.appIdentifier,
			selector,
			selectorIndex: options.selectorIndex,
			sampleCount: Number.isFinite(options.limit) ? options.limit : 8,
			scrollStepPx: options.scrollStepPx,
			settleMs: Number.isFinite(options.settleMs) ? options.settleMs : 300,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "agent-panel-scroll-page-probe",
				status: "fail",
				summary: ["Unable to probe agent panel scroll paging."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor, open a ledger-backed session panel, then retry agent-panel-scroll-page-probe."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("agent-panel-scroll-page-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const sampleSummary = probe.value.samples.slice(0, 4).map((sample) => {
			return `sample ${sample.stepIndex.toString()} top=${sample.scrollTopPx.toFixed(0)} rows=${sample.rowCount.toString()} buffer=${sample.bufferStartIndex === null ? "unknown" : sample.bufferStartIndex.toString()}-${sample.bufferEndIndex === null ? "unknown" : sample.bufferEndIndex.toString()} reason=${sample.bufferLastReason ?? "unknown"} first=${sample.firstRowId ?? "none"} last=${sample.lastRowId ?? "none"}`;
		});
		const result = buildResult({
			command: "agent-panel-scroll-page-probe",
			status:
				probe.value.selectorMatched &&
				probe.value.moved &&
				probe.value.loadedMoreRows &&
				!probe.value.likelyThrottled &&
				probe.value.blankViewportSampleCount === 0 &&
				probe.value.maxEmptyRowCount === 0 &&
				probe.value.maxExactGenericToolRowCount === 0 &&
				probe.value.maxPrefixGenericToolRowCount === 0 &&
				probe.value.maxRawProviderToolRowCount === 0
					? "ok"
					: "warn",
			summary: [
				`route: ${probe.value.route ?? "unknown"}`,
				`selector: ${probe.value.selector} index=${probe.value.selectorIndex.toString()}/${probe.value.selectorMatchCount.toString()} matched=${probe.value.selectorMatched ? "yes" : "no"}`,
				`scroll: step=${probe.value.scrollStepPx.toFixed(0)} settle=${probe.value.settleMs.toString()}ms initialTop=${probe.value.initialScrollTopPx === null ? "unavailable" : probe.value.initialScrollTopPx.toFixed(0)} finalTop=${probe.value.finalScrollTopPx === null ? "unavailable" : probe.value.finalScrollTopPx.toFixed(0)} reachedTop=${probe.value.reachedTop ? "yes" : "no"} moved=${probe.value.moved ? "yes" : "no"}`,
				`frame timing: samples=${probe.value.frameDeltasMs.length.toString()} missed120=${probe.value.missed120FrameCount.toString()} missed60=${probe.value.missed60FrameCount.toString()} avg=${formatOptionalMs(probe.value.averageFrameDeltaMs)} max=${formatOptionalMs(probe.value.maxFrameDeltaMs)} fps=${probe.value.estimatedFps === null ? "unavailable" : probe.value.estimatedFps.toFixed(2)} throttled=${probe.value.likelyThrottled ? "yes" : "no"}`,
				`scroll correction: maxHeightDelta=${probe.value.maxScrollHeightDeltaPx.toFixed(0)}px maxTopCorrection=${probe.value.maxScrollTopCorrectionPx.toFixed(0)}px`,
				`page traversal: loadedMoreRows=${probe.value.loadedMoreRows ? "yes" : "no"} distinctRows=${probe.value.distinctRowIdCount.toString()} distinctFirstRows=${probe.value.distinctFirstRowIdCount.toString()} maxSampleRows=${probe.value.maxSampleRowCount.toString()}`,
				`blank/tool-leaks: zeroRowSamples=${probe.value.zeroRowSampleCount.toString()} blankViewportSamples=${probe.value.blankViewportSampleCount.toString()} maxEmpty=${probe.value.maxEmptyRowCount.toString()} genericExact=${probe.value.maxExactGenericToolRowCount.toString()} genericPrefix=${probe.value.maxPrefixGenericToolRowCount.toString()} rawProvider=${probe.value.maxRawProviderToolRowCount.toString()}`,
				`scroll height: initial=${probe.value.initialScrollHeightPx === null ? "unavailable" : probe.value.initialScrollHeightPx.toFixed(0)} final=${probe.value.finalScrollHeightPx === null ? "unavailable" : probe.value.finalScrollHeightPx.toFixed(0)} client=${probe.value.clientHeightPx === null ? "unavailable" : probe.value.clientHeightPx.toFixed(0)} max=${probe.value.maxScrollTopPx === null ? "unavailable" : probe.value.maxScrollTopPx.toFixed(0)}`,
			].concat(sampleSummary),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "agent-panel-scroll-page-probe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "ledger-backfill-probe") {
		const probe = await probeLedgerBackfill({
			appIdentifier: options.appIdentifier,
			limit: Number.isFinite(options.limit) ? options.limit : 1,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "ledger-backfill-probe",
				status: "fail",
				summary: ["Unable to invoke warm_recent_transcript_row_ledgers in the WebView."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor and confirm the dev binary includes the ledger backfill command."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("ledger-backfill-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "ledger-backfill-probe",
			status: probe.value.failedCount === 0 ? "ok" : "warn",
			summary: [
				`limit: requested=${probe.value.requestedLimit.toString()} candidates=${probe.value.candidateCount.toString()} checked=${probe.value.checkedCount.toString()}`,
				`rebuilt: total=${probe.value.rebuiltCount.toString()} provider=${probe.value.rebuiltFromProviderCount.toString()}`,
				`skipped: upToDate=${probe.value.skippedCurrentCount.toString()} noJournal=${probe.value.skippedNoJournalCount.toString()} missingFacts=${probe.value.skippedMissingFactsCount.toString()}`,
				`failed: count=${probe.value.failedCount.toString()} ids=${probe.value.failedSessionIds.slice(0, 3).join(", ") || "none"}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "ledger-backfill-probe",
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
		const summary = formatDomInspectionSummary(inspection.value);
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

	if (options.command === "inspect-shadow") {
		if (options.hostSelector.length === 0 || options.selector.length === 0) {
			const result = buildResult({
				command: "inspect-shadow",
				status: "fail",
				summary: ["Missing --host-selector or --selector."],
				error: dependencyError(
					"missing_selector",
					"--host-selector and --selector are required.",
					"Example: bun run qa inspect-shadow --host-selector='[data-testid=\"git-file-tree\"]' --selector='button[data-type=\"item\"]'"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const inspection = await inspectShadowDom({
			appIdentifier: options.appIdentifier,
			hostSelector: options.hostSelector,
			selector: options.selector,
			limit: Number.isFinite(options.limit) ? options.limit : 10,
			skipDriver: options.skipDriver,
		});
		if (inspection.isErr()) {
			const result = buildResult({
				command: "inspect-shadow",
				status: "fail",
				summary: ["Unable to inspect the Acepe WebView shadow DOM."],
				error: dependencyError(
					inspection.error.code,
					inspection.error.message,
					"Run acepe-qa doctor, then retry inspect-shadow with host and inner selectors."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("inspect-shadow", inspection.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "inspect-shadow",
			status: "ok",
			summary: formatDomInspectionSummary(inspection.value),
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
			key: options.key.length === 0 ? null : options.key,
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

	if (options.command === "hover") {
		if (options.selector.length === 0 && options.text.length === 0) {
			const result = buildResult({
				command: "hover",
				status: "fail",
				summary: ["Missing --selector or --text."],
				error: dependencyError(
					"missing_target",
					"Hover needs a selector or text.",
					"Example: bun run qa hover --text='My session title'"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const hover = await hoverWebview({
			appIdentifier: options.appIdentifier,
			selector: options.selector.length === 0 ? null : options.selector,
			afterSelector: options.afterSelector.length === 0 ? null : options.afterSelector,
			afterLimit: Number.isFinite(options.limit) ? options.limit : 10,
			text: options.text.length === 0 ? null : options.text,
			skipDriver: options.skipDriver,
		});
		if (hover.isErr()) {
			const result = buildResult({
				command: "hover",
				status: "fail",
				summary: ["Unable to hover in the Acepe WebView."],
				error: dependencyError(
					hover.error.code,
					hover.error.message,
					"Run acepe-qa doctor, then retry hover."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("hover", hover.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const result = buildResult({
			command: "hover",
			status: hover.value.hovered ? "ok" : "warn",
			summary: [
				`hovered: ${hover.value.hovered ? "yes" : "no"}`,
				hover.value.match === null
					? "match: none"
					: `match: ${hover.value.match.tag} "${hover.value.match.text.slice(0, 80)}"`,
				hover.value.after === undefined || hover.value.after === null
					? "after: none"
					: `after: ${hover.value.after.count.toString()} matches for ${hover.value.after.selector}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "hover",
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
			summary: [`from: ${reload.value.from}`, `path: ${reload.value.path}`],
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
		const probeSummary = summarizeFirstSendProbe(probe.value);
		const result = buildResult({
			command: "first-send-probe",
			status: probeSummary.status,
			summary: probeSummary.lines,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "first-send-probe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "session-open-content-probe") {
		if (options.sessionId.length === 0) {
			const result = buildResult({
				command: "session-open-content-probe",
				status: "fail",
				summary: ["Missing --session-id."],
				error: dependencyError(
					"missing_session_id",
					"--session-id is required.",
					"Example: bun run qa session-open-content-probe --session-id=<id> --project-path=/path --agent-id=codex"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		if (options.projectPath.length === 0 || options.agentId.length === 0) {
			const result = buildResult({
				command: "session-open-content-probe",
				status: "fail",
				summary: ["Missing --project-path or --agent-id."],
				error: dependencyError(
					"missing_session_metadata",
					"--project-path and --agent-id are required for cold session registration.",
					"Pass the values from the session list or discover_all_projects_with_sessions."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}

		const probe = await probeSessionOpenContent({
			appIdentifier: options.appIdentifier,
			sessionId: options.sessionId,
			projectPath: options.projectPath,
			agentId: options.agentId,
			sourcePath: options.sourcePath.length === 0 ? null : options.sourcePath,
			title: options.title.length === 0 ? null : options.title,
			timeoutMs: options.timeoutMs,
			closeAfter: !options.keepOpen,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "session-open-content-probe",
				status: "fail",
				summary: ["Unable to probe session content open timing."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor; ensure the dev app contains the session-open QA hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("session-open-content-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const probeSummary = summarizeSessionOpenContentProbe(probe.value);
		const result = buildResult({
			command: "session-open-content-probe",
			status: probeSummary.status,
			summary: [
				`session: ${probe.value.sessionId} panel=${probe.value.panelId ?? "none"}`,
				`setup: knownBefore=${probe.value.sessionKnownBeforeOpen ? "yes" : "no"} placeholder=${probe.value.placeholderRegistered ? "yes" : "no"} closedExisting=${probe.value.closedExistingPanel ? "yes" : "no"}`,
				`foreground: start=${probe.value.documentVisibilityAtStart} focusStart=${probe.value.documentHasFocusAtStart ? "yes" : "no"} end=${probe.value.documentVisibilityAtEnd} focusEnd=${probe.value.documentHasFocusAtEnd ? "yes" : "no"} frameTiming=${probe.value.foregroundFrameTimingValid ? "valid" : "invalid"}`,
				`timing: select=${formatOptionalMs(probe.value.selectCallMs)} panelDom=${formatOptionalMs(probe.value.panelDomReadyMs)} viewport=${formatOptionalMs(probe.value.transcriptViewportReadyMs)} firstRowDom=${formatOptionalMs(probe.value.firstRowDomReadyMs)} firstRowPaint=${formatOptionalMs(probe.value.firstRowPaintMs)}`,
				`rows: firstPaint=${probe.value.rowCountAtFirstPaint.toString()} final=${probe.value.finalRowCount.toString()}`,
				`end state: closeAfter=${probe.value.closeAfterRequested ? "yes" : "no"} panelStore=${probe.value.panelStillOpenAtEnd ? "open" : "closed"} panelDom=${probe.value.panelDomPresentAtEnd ? "present" : "missing"} session=${probe.value.sessionKnownAtEnd ? "known" : "unknown"} canonical=${probe.value.sessionHasCanonicalProjectionAtEnd ? "yes" : "no"} lifecycle=${probe.value.sessionLifecycleStatusAtEnd ?? "none"} canSend=${probe.value.sessionCanSendAtEnd === null ? "unknown" : probe.value.sessionCanSendAtEnd ? "yes" : "no"} messages=${probe.value.sessionMessageCountAtEnd === null ? "unknown" : probe.value.sessionMessageCountAtEnd.toString()}`,
				`runtime errors: ${probe.value.runtimeErrors.length === 0 ? "none" : probe.value.runtimeErrors.slice(0, 3).join(" | ")}`,
				`tauri invokes: count=${probe.value.tauriInvokeTimings.length.toString()} top=${formatSessionOpenInvokeTopList(probe.value.tauriInvokeTimings, 6)}`,
				`pending tauri invokes: count=${probe.value.pendingTauriInvokes.length.toString()} top=${formatPendingInvokeTopList(probe.value.pendingTauriInvokes, 6)}`,
				`open events: count=${probe.value.openEvents.length.toString()} tail=${formatSessionOpenEvents(probe.value.openEvents, 8)}`,
				`hydration timings: count=${probe.value.hydrationTimings.length.toString()} top=${formatHydrationTimingTopList(probe.value.hydrationTimings, 3)}`,
				`panel open marks: ${formatPanelOpenMarks(probe.value.panelOpenMarks)}`,
				`frontend profile: samples=${probe.value.agentPanelPerformanceSamples.length.toString()} top=${formatAgentPanelPerformanceTopList(probe.value.agentPanelPerformanceSamples, 6)}`,
				probeSummary.backendLine,
				probeSummary.targetLine,
			].concat(probe.value.errorMessage === null ? [] : [`error: ${probe.value.errorMessage}`]),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "session-open-content-probe",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "happy-path-perf") {
		const probe = await probeHappyPathPerformance({
			appIdentifier: options.appIdentifier,
			timeoutMs: options.timeoutMs,
			skipDriver: options.skipDriver,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "happy-path-perf",
				status: "fail",
				summary: ["Unable to probe happy-path performance."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Run acepe-qa doctor; ensure the dev app contains the happy-path QA hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("happy-path-perf", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const leakedPanel =
			probe.value.app.panelCountAfter !== probe.value.app.panelCountBefore ||
			probe.value.app.domPanelCountAfter !== probe.value.app.domPanelCountBefore;
		const projectUnavailable = !probe.value.app.projectReady;
		const result = buildResult({
			command: "happy-path-perf",
			status: probe.value.hookAvailable && !leakedPanel && !projectUnavailable ? "ok" : "warn",
			summary: [
				`hook: ${probe.value.hookAvailable ? "available" : "missing"}`,
				`route: ${probe.value.route}`,
				`runtime errors: ${probe.value.runtimeErrors.length === 0 ? "none" : probe.value.runtimeErrors.slice(0, 3).join(" | ")}`,
				`timing env: ${probe.value.timingEnvironment.label}`,
				`navigation: type=${probe.value.navigation.type ?? "unknown"} domContentLoaded=${formatOptionalMs(probe.value.navigation.domContentLoadedMs)} load=${formatOptionalMs(probe.value.navigation.loadEventEndMs)} duration=${formatOptionalMs(probe.value.navigation.durationMs)}`,
				`shell ready: ready=${probe.value.app.shellReady ? "yes" : "no"} duration=${formatOptionalMs(probe.value.app.shellReadyDurationMs)} wait=${formatOptionalMs(probe.value.app.shellReadyWaitMs)}`,
				`app init: complete=${probe.value.app.initializationComplete ? "yes" : "no"} duration=${formatOptionalMs(probe.value.app.initializationDurationMs)} wait=${formatOptionalMs(probe.value.app.initializationWaitMs)}`,
				`project ready: ready=${probe.value.app.projectReady ? "yes" : "no"} wait=${formatOptionalMs(probe.value.app.projectReadyWaitMs)} projects=${probe.value.app.projectCountAtPanelCreate.toString()}`,
				`panel open: create=${formatOptionalMs(probe.value.openClose.panelCreateMs)} dom=${formatOptionalMs(probe.value.openClose.panelDomReadyMs)} composer=${formatOptionalMs(probe.value.openClose.composerReadyAfterCreateMs)}`,
				`panel open marked: preMark=${formatOptionalMs(probe.value.openClose.panelPreMarkDelayMs)} markedWork=${formatOptionalMs(probe.value.openClose.panelMarkedWorkMs)} domAfterMark=${formatOptionalMs(probe.value.openClose.panelDomReadyAfterLastMarkMs)} composerAfterMark=${formatOptionalMs(probe.value.openClose.composerReadyAfterLastMarkMs)}`,
				`panel open detail: afterCreate=${probe.value.openClose.panelDomPresentAfterCreate ? "yes" : "no"} mutation=${formatOptionalMs(probe.value.openClose.panelDomMutationMs)} afterFlush=${formatOptionalMs(probe.value.openClose.panelDomAfterDomFlushMs)} afterFrame=${formatOptionalMs(probe.value.openClose.panelDomAfterFirstFrameMs)} composerMutation=${formatOptionalMs(probe.value.openClose.composerMutationMs)} composerWait=${formatOptionalMs(probe.value.openClose.composerReadyMs)}`,
				`panel open marks: ${formatPanelOpenMarks(probe.value.openClose.panelOpenMarks)}`,
				`panel open dom: nodes=${probe.value.openClose.panelDomNodeCount.toString()} rows=${probe.value.openClose.panelRowNodeCount.toString()} dropdownContent=${probe.value.openClose.panelDropdownContentNodeCount.toString()} resizeObservers=${formatOptionalCount(probe.value.openClose.resizeObserverConstructCount)} observe=${formatOptionalCount(probe.value.openClose.resizeObserverObserveCount)} callbacks=${formatOptionalCount(probe.value.openClose.resizeObserverCallbackCount)}`,
				`panel close: call=${formatOptionalMs(probe.value.openClose.closeCallReturnMs)} microtask=${formatOptionalMs(probe.value.openClose.closeMicrotaskMs)} frame=${formatOptionalMs(probe.value.openClose.closeFirstFrameMs)} gone=${formatOptionalMs(probe.value.openClose.closeDomGoneMs)} total=${formatOptionalMs(probe.value.openClose.totalMs)}`,
				`panel close dom: microtask=${probe.value.openClose.closeDomGoneAfterMicrotask ? "gone" : "present"} firstFrame=${probe.value.openClose.closeDomGoneAfterFirstFrame ? "gone" : "present"}`,
				`panel counts: store ${probe.value.app.panelCountBefore.toString()} -> ${probe.value.app.panelCountAfter.toString()}, dom ${probe.value.app.domPanelCountBefore.toString()} -> ${probe.value.app.domPanelCountAfter.toString()}`,
			]
				.concat(formatPanelCloseTraceSummary(probe.value))
				.concat(formatProjectLoadTraceSummary(probe.value))
				.concat(formatTauriInvokeSummary(probe.value))
				.concat(formatStartupTraceSummary(probe.value)),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "happy-path-perf",
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
		const streamingPerfLines =
			lab.value.performance === null
				? ["stream perf: unavailable"]
				: (() => {
						const steps = lab.value.performance.steps;
						const slowest = steps.reduce(
							(currentSlowest, step) =>
								step.domFlushMs > currentSlowest.domFlushMs ? step : currentSlowest,
							steps[0] ?? {
								phaseId: "none",
								label: "none",
								phaseIndex: 0,
								assistantTextLength: 0,
								turnState: "unknown",
								domFlushMs: 0,
								rowCount: 0,
								animatedTokenSpans: 0,
								tokenRevealMode: null,
							}
						);
						return [
							`stream perf: phases=${lab.value.performance.phaseCount.toString()} total=${formatOptionalMs(lab.value.performance.totalMs)}`,
							`stream env: ${lab.value.performance.visibilityState} focus=${lab.value.performance.documentHasFocus === null ? "unknown" : lab.value.performance.documentHasFocus ? "yes" : "no"}`,
							`stream slowest flush: phase=${slowest.phaseId} flush=${formatOptionalMs(slowest.domFlushMs)} rows=${slowest.rowCount.toString()} chars=${slowest.assistantTextLength.toString()} animated=${slowest.animatedTokenSpans.toString()}`,
						];
					})();
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
			].concat(streamingPerfLines),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "streaming-repro-lab",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "agent-panel-stress-lab" || options.command === "stress-lab") {
		const rowCount = Number.isFinite(options.rows) ? options.rows : 1_000;
		const seed = Number.isFinite(options.seed) ? options.seed : 1;
		const lab = await openAgentPanelStressLab({
			appIdentifier: options.appIdentifier,
			rowCount,
			preset: options.preset,
			rendererMode: options.rendererMode,
			seed,
			includeStreamingTail: !options.noStreamingTail,
			runScrollSample: !options.noScrollSample,
			delayMs: Number.isFinite(options.delayMs) ? options.delayMs : 300,
			timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20_000,
			skipDriver: options.skipDriver,
		});
		if (lab.isErr()) {
			const result = buildResult({
				command: options.command,
				status: "fail",
				summary: ["Unable to run the Agent Panel Stress Lab."],
				error: dependencyError(
					lab.error.code,
					lab.error.message,
					"Run acepe-qa doctor; ensure the dev app contains the agent panel stress QA hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("agent-panel-stress-lab", lab.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const rowLabel = lab.value.rowCount === null ? "unknown" : lab.value.rowCount.toLocaleString();
		const domRowLabel =
			lab.value.domRowCount === null ? "unknown" : lab.value.domRowCount.toLocaleString();
		const measurementWarningLines = agentPanelStressLabMeasurementWarnings(lab.value).map(
			(warning) => `measurement warning: ${warning}`
		);
		const profilePhaseLines =
			lab.value.dump === null
				? ["profile: unavailable"]
				: lab.value.dump.profileSummary.phases.slice(0, 5).map((phase) => {
						const maxItems =
							phase.maxItemCount === null ? "n/a" : phase.maxItemCount.toLocaleString();
						return `profile: ${phase.phase} total=${formatOptionalMs(phase.totalDurationMs)} max=${formatOptionalMs(phase.maxDurationMs)} count=${phase.count.toString()} items=${maxItems}`;
					});
		const scrollUpdateLine =
			lab.value.dump === null
				? "scroll update: unavailable"
				: `scroll update: samples=${lab.value.dump.summary.scrollUpdateSampleCount.toString()} avg=${formatOptionalMs(lab.value.dump.summary.averageScrollUpdateMs)} max=${formatOptionalMs(lab.value.dump.summary.maxScrollUpdateMs)} maxDomRows=${lab.value.dump.summary.maxScrollUpdateDomRowCount === null ? "unavailable" : lab.value.dump.summary.maxScrollUpdateDomRowCount.toLocaleString()}`;
		const scrollChurnLine =
			lab.value.dump === null
				? "scroll churn: unavailable"
				: `scroll churn: maxMounted=${lab.value.dump.summary.maxScrollUpdateMountedRowCount === null ? "unavailable" : lab.value.dump.summary.maxScrollUpdateMountedRowCount.toLocaleString()} maxUnmounted=${lab.value.dump.summary.maxScrollUpdateUnmountedRowCount === null ? "unavailable" : lab.value.dump.summary.maxScrollUpdateUnmountedRowCount.toLocaleString()} maxCold=${lab.value.dump.summary.maxFrameColdRevealedRowCount === null ? "unavailable" : lab.value.dump.summary.maxFrameColdRevealedRowCount.toLocaleString()} maxStaticErr=${formatOptionalMs(lab.value.dump.summary.maxFrameStaticEstimateErrorPx)} profileMax=${formatOptionalMs(lab.value.dump.summary.maxScrollUpdateProfileDurationMs)} phase=${lab.value.dump.summary.maxScrollUpdateProfileSlowestPhase ?? "unavailable"}`;
		const frameBudgetLine =
			lab.value.dump === null
				? "frame budget: unavailable"
				: `frame budget: target=${formatOptionalMs(lab.value.dump.summary.targetFrameBudgetMs)} missed120=${lab.value.dump.summary.missed120HzFrameCount.toString()} maxOver=${formatOptionalMs(lab.value.dump.summary.maxFrameBudgetOverrunMs)}`;
		const slowestFrameLine =
			lab.value.dump === null
				? "slowest frame: unavailable"
				: `slowest frame: index=${lab.value.dump.summary.slowestFrameIndex === null ? "unavailable" : lab.value.dump.summary.slowestFrameIndex.toString()} delta=${formatOptionalMs(lab.value.dump.summary.slowestFrameDeltaMs)} cause=${lab.value.dump.summary.slowestFrameCause ?? "unavailable"} profile=${formatOptionalMs(lab.value.dump.summary.slowestFrameProfileDurationMs)} browser=${formatOptionalMs(lab.value.dump.summary.slowestFrameBrowserRenderMs)} prevBrowser=${formatOptionalMs(lab.value.dump.summary.slowestFramePreviousBrowserRenderMs)} preGap=${formatOptionalMs(lab.value.dump.summary.slowestFramePreFrameGapMs)} mounted=${lab.value.dump.summary.slowestFrameMountedRowCount === null ? "unavailable" : lab.value.dump.summary.slowestFrameMountedRowCount.toString()} unmounted=${lab.value.dump.summary.slowestFrameUnmountedRowCount === null ? "unavailable" : lab.value.dump.summary.slowestFrameUnmountedRowCount.toString()} cold=${lab.value.dump.summary.slowestFrameColdRevealedRowCount === null ? "unavailable" : lab.value.dump.summary.slowestFrameColdRevealedRowCount.toString()} static=${lab.value.dump.summary.slowestFrameStaticEstimateRowCount === null ? "unavailable" : lab.value.dump.summary.slowestFrameStaticEstimateRowCount.toString()} measured=${lab.value.dump.summary.slowestFrameMeasuredEstimateRowCount === null ? "unavailable" : lab.value.dump.summary.slowestFrameMeasuredEstimateRowCount.toString()} maxErr=${formatOptionalMs(lab.value.dump.summary.slowestFrameMaxStaticEstimateErrorPx)} avgErr=${formatOptionalMs(lab.value.dump.summary.slowestFrameAverageStaticEstimateErrorPx)} rows=${lab.value.dump.summary.slowestFrameDomRowCount === null ? "unavailable" : lab.value.dump.summary.slowestFrameDomRowCount.toString()}`;
		const result = buildResult({
			command: options.command,
			status: agentPanelStressLabStatus(lab.value),
			summary: [
				`hook: ${lab.value.hookAvailable ? "available" : "missing"}`,
				`opened: ${lab.value.opened ? "yes" : "no"}`,
				`lab: ${lab.value.labPresent ? "present" : "missing"}`,
				`scenario: rows=${rowLabel} preset=${lab.value.preset ?? "unknown"} renderer=${lab.value.rendererMode ?? "unknown"} seed=${lab.value.seed?.toString() ?? "unknown"}`,
				`DOM rows: ${domRowLabel}`,
				`render settle: ${formatOptionalMs(lab.value.renderSettleMs)}`,
				`scroll: bottom=${formatOptionalMs(lab.value.scrollToBottomMs)} top=${formatOptionalMs(lab.value.scrollToTopMs)}`,
				`frames: samples=${lab.value.frameSampleCount.toString()} jank=${lab.value.jankFrameCount.toString()} avg=${formatOptionalMs(lab.value.averageFrameDeltaMs)} max=${formatOptionalMs(lab.value.maxFrameDeltaMs)}`,
				`frame env: ${lab.value.frameEnvironmentLabel ?? "unavailable"}`,
				`frame throttle: ${lab.value.frameSamplingLikelyThrottled === null ? "unknown" : lab.value.frameSamplingLikelyThrottled ? "likely" : "no"}`,
				`estimated fps: ${lab.value.estimatedFps === null ? "unavailable" : lab.value.estimatedFps.toFixed(2)}`,
				frameBudgetLine,
				slowestFrameLine,
				scrollUpdateLine,
				scrollChurnLine,
				`memory: ${lab.value.memoryLabel ?? "unavailable"}`,
			]
				.concat(measurementWarningLines)
				.concat(profilePhaseLines),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "agent-panel-stress-lab",
			error: artifact.isErr()
				? dependencyError(artifact.error.code, artifact.error.message, "Check /tmp permissions.")
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "hmr-ui-probe") {
		const probe = await probeUiPackageHmr({
			checkoutRoot: options.checkoutRoot,
			viteDevUrl: options.path.length > 0 ? options.path : undefined,
			timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12_000,
		});
		if (probe.isErr()) {
			const result = buildResult({
				command: "hmr-ui-probe",
				status: "fail",
				summary: ["Unable to probe @acepe/ui HMR."],
				error: dependencyError(
					probe.error.code,
					probe.error.message,
					"Start bun tauri dev, restart after vite.config alias changes, then rerun bun run qa hmr-ui-probe."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await writeJsonArtifact("hmr-ui-probe", probe.value);
		const artifactPath = artifact.isOk() ? artifact.value : undefined;
		const value = probe.value;
		const result = buildResult({
			command: "hmr-ui-probe",
			status:
				value.svelteUpdatePaths.length === 1 && !value.duplicateModuleIdentity ? "ok" : "fail",
			summary: [
				`edited: ${value.editedBasename}`,
				`svelte update paths: ${value.svelteUpdatePaths.length.toString()}`,
				value.svelteUpdatePaths.length === 0
					? "paths: none (is the dev server running and has the file been imported?)"
					: `paths: ${value.svelteUpdatePaths.join(", ")}`,
				`duplicate module identity: ${value.duplicateModuleIdentity ? "yes" : "no"}`,
				`vite dev url: ${value.viteDevUrl}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "hmr-ui-probe",
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return statusExitCode(result.status);
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
			"Use doctor, focus-app, frame-rate-probe, agent-panel-row-scan, agent-panel-scroll-page-probe, observe, screenshot, navigate, inspect, click, hover, thinking-toggle-probe, first-send-probe, happy-path-perf, streaming-repro-lab, agent-panel-stress-lab, hmr-ui-probe, send, watch, or reset-onboarding."
		),
	});
	process.stdout.write(formatCommandResult(result, options.format));
	return statusExitCode(result.status);
}
