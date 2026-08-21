import { spawnSync } from "node:child_process";
import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
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
	probeComposerEnterSubmit,
	probeComputerUse,
	probeFirstSendTimeline,
	probeFrameRate,
	probeHappyPathPerformance,
	probeLedgerBackfill,
	probePanelResize,
	probePanelResizeStream,
	probePlanningBetweenTools,
	probeSendAttachStress,
	probeSessionOpenContent,
	probeThinkingToggle,
	readPlanningDebug,
	reloadWebview,
	resetOnboarding,
	scanAgentPanelRows,
	selectPanelProject,
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
import {
	type DomInspectionResult,
	type FocusAppResult,
	type HappyPathPerformanceResult,
	observeLevelSchema,
	type SessionOpenContentProbeResult,
	type TargetProcess,
	type TauriPendingInvokeRecord,
} from "./schemas";
import { summarizeSessionOpenContentProbe } from "./session-open-probe-summary";

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
	readonly thenSelector: string;
	readonly thenText: string;
	readonly action: string;
	readonly targetLabel: string;
	readonly key: string;
	readonly dx: number | null;
	readonly dy: number | null;
	readonly sessionId: string;
	readonly panelId: string;
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
	readonly preScrollOffsetPx: number | null;
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
			thenSelector: "",
			thenText: "",
			action: "",
			targetLabel: "",
			key: "",
			dx: null,
			dy: null,
			sessionId: "",
			panelId: "",
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
			preScrollOffsetPx: null,
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
	const levelParsed = decodeUnknown(observeLevelSchema, (error) => error)(levelCandidate);
	const level = Result.isSuccess(levelParsed) ? levelParsed.success : "summary";
	const defaultDelayMs = command === "hover" ? "350" : "300";
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
		thenSelector: valueArg(args, "--then-selector", ""),
		thenText: valueArg(args, "--then-text", ""),
		action: valueArg(args, "--action", ""),
		targetLabel: valueArg(args, "--target-label", ""),
		key: valueArg(args, "--key", ""),
		dx: numberArg(args, "--dx"),
		dy: numberArg(args, "--dy"),
		sessionId: valueArg(args, "--session-id", ""),
		panelId: valueArg(args, "--panel-id", ""),
		projectPath: valueArg(args, "--project-path", ""),
		agentId: valueArg(args, "--agent-id", ""),
		sourcePath: valueArg(args, "--source-path", ""),
		title: valueArg(args, "--title", ""),
		path: valueArg(args, "--path", ""),
		limit: Number.parseInt(valueArg(args, "--limit", "10"), 10),
		delayMs: Number.parseInt(
			valueArg(args, "--delay", valueArg(args, "--delay-ms", defaultDelayMs)),
			10
		),
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
		preScrollOffsetPx: numberArg(args, "--pre-scroll-offset-px"),
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
	const evidence = await Effect.runPromise(
		Effect.result(
			writeUiQaEvidence({
				checkoutRoot: options.checkoutRoot,
				command: result.command,
				status: result.status,
				summary: result.summary,
				artifactPath: result.artifact?.path,
			})
		)
	);
	const output = Result.isSuccess(evidence)
		? {
				command: result.command,
				status: result.status,
				summary: result.summary.concat(`ui qa evidence: ${evidence.success}`),
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
				"usage: bun run qa [doctor|focus-app|frame-rate-probe|agent-panel-row-scan|agent-panel-scroll-page-probe|ledger-backfill-probe|observe|screenshot|navigate|reload|inspect|inspect-shadow|select-project|click|hover|computer-probe|resize-probe|resize-stream-probe|thinking-toggle-probe|first-send-probe|composer-enter-probe|session-open-content-probe|happy-path-perf|streaming-repro-lab|agent-panel-stress-lab|planning-between-tools-probe|send-attach-stress-probe|hmr-ui-probe|send|watch|reset-onboarding] [--app=9223] [--format=json]",
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
				"select-project selects --project-path inside the exact --panel-id after read-only path resolution and rejects ambiguous project names.",
				"click clicks by --selector or --text; add --then-selector or --then-text for a popover item, or --key=Enter to activate focused controls.",
				"hover hovers by --selector or --text; add --after-selector to inspect immediately after hover.",
				"computer-probe invokes the real app's acepe_computer.act MCP path; add --action and --target-label to act.",
				"resize-probe drags the first panel resize edge and reports frame-by-frame width lag; tune with --dx, --limit steps, --delay ms.",
				"resize-stream-probe streams pointer moves over --timeout ms and reports continuous-drag lag.",
				"thinking-toggle-probe clicks the first thinking block and samples open/closed state over 500ms.",
				"first-send-probe types into an exact --panel-id/--session-id composer, clicks send, and samples optimistic/planning visibility.",
				"composer-enter-probe types into an exact --panel-id/--session-id composer and verifies plain Enter submission.",
				"session-open-content-probe opens --session-id and reports panel, transcript viewport, and first row paint timing; use --keep-open to inspect failures.",
				"happy-path-perf measures app timing plus temporary agent panel open/composer-ready/close timing.",
				"streaming-repro-lab opens the dev Streaming Repro Lab and samples native token reveal DOM.",
				"agent-panel-stress-lab opens the Agent Panel Stress Lab and samples render/scroll metrics; tune with --rows, --preset, --renderer-mode, --seed.",
				"planning-between-tools-probe runs the provider-free completed-tool to active-assistant transition and restores the visible planning stage.",
				"send-attach-stress-probe runs the provider-free send/first-stream WebKit geometry scenario; tune with --rows and --pre-scroll-offset-px.",
				"hmr-ui-probe edits a @acepe/ui Svelte file and asserts Vite emits a single canonical HMR path (requires running dev server; restart after vite.config alias changes).",
				"send types --text into the composer and submits; scope multi-panel QA with --panel-id and --session-id (use --no-submit to type only).",
				"watch polls for --text and reports whether it is actually VISIBLE (not just in the DOM), with --timeout ms.",
				"reset-onboarding opens Dev Tools, resets onboarding, and returns onboarding facts.",
			],
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return 0;
	}

	if (options.command === "doctor") {
		const doctor = await Effect.runPromise(
			Effect.result(
				runDoctor({
					checkoutRoot: options.checkoutRoot,
					appIdentifier: options.appIdentifier,
				})
			)
		);
		if (Result.isFailure(doctor)) {
			const result = buildResult({
				command: "doctor",
				status: "fail",
				summary: ["Unable to inspect the Acepe dev target."],
				error: dependencyError(
					doctor.failure.code,
					doctor.failure.message,
					"Check that the dev app is running, then rerun acepe-qa doctor."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("doctor", doctor.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const summary = [
			`dev processes: ${doctor.success.devProcessCount.toString()}`,
			`production processes: ${doctor.success.productionProcessCount.toString()}`,
			`bridge ${doctor.success.bridge.available ? "ok" : "missing"} on ${doctor.success.bridge.port}`,
			`webview ${doctor.success.webview.responsive ? "responsive" : "not responsive"}`,
			`binary: ${doctor.success.binaryFreshness.status}`,
			`frontend: ${doctor.success.frontendFreshness.status}`,
		].concat(doctor.success.findings);
		const result = buildResult({
			command: "doctor",
			status: doctor.success.status,
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "doctor",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return statusExitCode(result.status);
	}

	if (options.command === "focus-app") {
		const doctor = await Effect.runPromise(
			Effect.result(
				runDoctor({
					checkoutRoot: options.checkoutRoot,
					appIdentifier: options.appIdentifier,
				})
			)
		);
		const focusAppIdentifier = Result.isSuccess(doctor)
			? doctor.success.appIdentifier
			: options.appIdentifier;
		const devProcesses = Result.isSuccess(doctor) ? doctor.success.devProcesses : [];
		const targetSummary =
			Result.isSuccess(doctor) && focusAppIdentifier !== options.appIdentifier
				? [`resolved active bridge: ${focusAppIdentifier}`]
				: [];
		const webviewFocus = await Effect.runPromise(
			Effect.result(
				focusDevApp({
					appIdentifier: focusAppIdentifier,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isSuccess(webviewFocus)) {
			if (focusAppIsForeground(webviewFocus.success)) {
				const result = buildResult({
					command: "focus-app",
					status: "ok",
					summary: targetSummary.concat(focusAppSummary(webviewFocus.success)),
				});
				return emitVerifiedUiResult(options, result);
			}
			const focus = focusAcepeApp(focusAppIdentifier, devProcesses);
			if (focus.ok) {
				const retryWebviewFocus = await Effect.runPromise(
					Effect.result(
						focusDevApp({
							appIdentifier: focusAppIdentifier,
							skipDriver: options.skipDriver,
						})
					)
				);
				if (Result.isSuccess(retryWebviewFocus)) {
					const focused = focusAppIsForeground(retryWebviewFocus.success);
					const result = buildResult({
						command: "focus-app",
						status: focused ? "ok" : "warn",
						summary: targetSummary
							.concat([
								"initial webview focus was not foreground.",
								`accessibility fallback: ${focus.message}`,
							])
							.concat(focusAppSummary(retryWebviewFocus.success)),
					});
					return emitVerifiedUiResult(options, result);
				}
				const result = buildResult({
					command: "focus-app",
					status: "warn",
					summary: targetSummary
						.concat(focusAppSummary(webviewFocus.success))
						.concat(
							`accessibility fallback: ${focus.message}`,
							`retry webview focus failed: ${retryWebviewFocus.failure.message}`
						),
				});
				return emitVerifiedUiResult(options, result);
			}
			const result = buildResult({
				command: "focus-app",
				status: "warn",
				summary: targetSummary
					.concat(focusAppSummary(webviewFocus.success))
					.concat(`accessibility fallback: ${focus.message}`),
			});
			return emitVerifiedUiResult(options, result);
		}

		const focus = focusAcepeApp(focusAppIdentifier, devProcesses);
		const result = buildResult({
			command: "focus-app",
			status: focus.ok ? "ok" : "fail",
			summary: targetSummary.concat([
				`webview focus failed: ${webviewFocus.failure.message}`,
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
		const probe = await Effect.runPromise(
			Effect.result(
				probeFrameRate({
					appIdentifier: options.appIdentifier,
					sampleCount,
					selector: options.selector,
					selectorIndex: options.selectorIndex,
					collectRowChurn: options.withRowChurn,
					collectAgentPanelProfile: options.withProfile,
					scrollStepPx: options.scrollStepPx,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "frame-rate-probe",
				status: "fail",
				summary: ["Unable to sample WebView frame rate."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor, focus-app, then retry frame-rate-probe."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("frame-rate-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "frame-rate-probe",
			status: frameRateProbeTimingValid(probe.success) ? "ok" : "warn",
			summary: summarizeFrameRateProbe(probe.success, {
				scrollStepPx: options.scrollStepPx,
			}),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "frame-rate-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "agent-panel-row-scan") {
		const selector =
			options.selector.length > 0
				? options.selector
				: '[data-testid="agent-panel-host"] .message-scroller__viewport';
		const scan = await Effect.runPromise(
			Effect.result(
				scanAgentPanelRows({
					appIdentifier: options.appIdentifier,
					selector,
					selectorIndex: options.selectorIndex,
					limit: Number.isFinite(options.limit) ? options.limit : 10,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(scan)) {
			const result = buildResult({
				command: "agent-panel-row-scan",
				status: "fail",
				summary: ["Unable to scan the active agent panel rows."],
				error: dependencyError(
					scan.failure.code,
					scan.failure.message,
					"Run acepe-qa doctor, open a session panel, then retry agent-panel-row-scan."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("agent-panel-row-scan", scan.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const rowSamples = scan.success.rows.slice(0, 5).map((row) => {
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
				scan.success.selectorMatched &&
				scan.success.rowCount > 0 &&
				scan.success.exactGenericToolRowCount === 0 &&
				scan.success.prefixGenericToolRowCount === 0 &&
				scan.success.rawProviderToolRowCount === 0 &&
				scan.success.missingEntryRowCount === 0 &&
				scan.success.degradedToolRowCount === 0 &&
				scan.success.emptyRowCount === 0
					? "ok"
					: "warn",
			summary: [
				`route: ${scan.success.route ?? "unknown"}`,
				`selector: ${scan.success.selector} index=${scan.success.selectorIndex.toString()}/${scan.success.selectorMatchCount.toString()} matched=${scan.success.selectorMatched ? "yes" : "no"}`,
				`rows: count=${scan.success.rowCount.toString()} first=${scan.success.firstRowIndex === null ? "unknown" : scan.success.firstRowIndex.toString()} last=${scan.success.lastRowIndex === null ? "unknown" : scan.success.lastRowIndex.toString()} empty=${scan.success.emptyRowCount.toString()}`,
				`scroll: top=${scan.success.scrollTopPx === null ? "unavailable" : scan.success.scrollTopPx.toFixed(0)} client=${scan.success.clientHeightPx === null ? "unavailable" : scan.success.clientHeightPx.toFixed(0)} height=${scan.success.scrollHeightPx === null ? "unavailable" : scan.success.scrollHeightPx.toFixed(0)} max=${scan.success.maxScrollTopPx === null ? "unavailable" : scan.success.maxScrollTopPx.toFixed(0)}`,
				`tool label leaks: genericExact=${scan.success.exactGenericToolRowCount.toString()} genericPrefix=${scan.success.prefixGenericToolRowCount.toString()} rawProvider=${scan.success.rawProviderToolRowCount.toString()}`,
				`visual state leaks: missing=${scan.success.missingEntryRowCount.toString()} degraded=${scan.success.degradedToolRowCount.toString()}`,
			].concat(rowSamples),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "agent-panel-row-scan",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "agent-panel-scroll-page-probe") {
		const selector =
			options.selector.length > 0
				? options.selector
				: '[data-testid="agent-panel-host"] .message-scroller__viewport';
		const probe = await Effect.runPromise(
			Effect.result(
				probeAgentPanelScrollPages({
					appIdentifier: options.appIdentifier,
					selector,
					selectorIndex: options.selectorIndex,
					sampleCount: Number.isFinite(options.limit) ? options.limit : 8,
					scrollStepPx: options.scrollStepPx,
					settleMs: Number.isFinite(options.settleMs) ? options.settleMs : 300,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "agent-panel-scroll-page-probe",
				status: "fail",
				summary: ["Unable to probe agent panel scroll paging."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor, open a ledger-backed session panel, then retry agent-panel-scroll-page-probe."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("agent-panel-scroll-page-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const sampleSummary = probe.success.samples.slice(0, 4).map((sample) => {
			return `sample ${sample.stepIndex.toString()} top=${sample.scrollTopPx.toFixed(0)} rows=${sample.rowCount.toString()} buffer=${sample.bufferStartIndex === null ? "unknown" : sample.bufferStartIndex.toString()}-${sample.bufferEndIndex === null ? "unknown" : sample.bufferEndIndex.toString()} reason=${sample.bufferLastReason ?? "unknown"} first=${sample.firstRowId ?? "none"} last=${sample.lastRowId ?? "none"}`;
		});
		const result = buildResult({
			command: "agent-panel-scroll-page-probe",
			status:
				probe.success.selectorMatched &&
				probe.success.moved &&
				probe.success.loadedMoreRows &&
				!probe.success.likelyThrottled &&
				probe.success.blankViewportSampleCount === 0 &&
				probe.success.maxEmptyRowCount === 0 &&
				probe.success.maxExactGenericToolRowCount === 0 &&
				probe.success.maxPrefixGenericToolRowCount === 0 &&
				probe.success.maxRawProviderToolRowCount === 0
					? "ok"
					: "warn",
			summary: [
				`route: ${probe.success.route ?? "unknown"}`,
				`selector: ${probe.success.selector} index=${probe.success.selectorIndex.toString()}/${probe.success.selectorMatchCount.toString()} matched=${probe.success.selectorMatched ? "yes" : "no"}`,
				`scroll: step=${probe.success.scrollStepPx.toFixed(0)} settle=${probe.success.settleMs.toString()}ms initialTop=${probe.success.initialScrollTopPx === null ? "unavailable" : probe.success.initialScrollTopPx.toFixed(0)} finalTop=${probe.success.finalScrollTopPx === null ? "unavailable" : probe.success.finalScrollTopPx.toFixed(0)} reachedTop=${probe.success.reachedTop ? "yes" : "no"} moved=${probe.success.moved ? "yes" : "no"}`,
				`frame timing: samples=${probe.success.frameDeltasMs.length.toString()} missed120=${probe.success.missed120FrameCount.toString()} missed60=${probe.success.missed60FrameCount.toString()} avg=${formatOptionalMs(probe.success.averageFrameDeltaMs)} max=${formatOptionalMs(probe.success.maxFrameDeltaMs)} fps=${probe.success.estimatedFps === null ? "unavailable" : probe.success.estimatedFps.toFixed(2)} throttled=${probe.success.likelyThrottled ? "yes" : "no"}`,
				`scroll correction: maxHeightDelta=${probe.success.maxScrollHeightDeltaPx.toFixed(0)}px maxTopCorrection=${probe.success.maxScrollTopCorrectionPx.toFixed(0)}px`,
				`page traversal: loadedMoreRows=${probe.success.loadedMoreRows ? "yes" : "no"} distinctRows=${probe.success.distinctRowIdCount.toString()} distinctFirstRows=${probe.success.distinctFirstRowIdCount.toString()} maxSampleRows=${probe.success.maxSampleRowCount.toString()}`,
				`blank/tool-leaks: zeroRowSamples=${probe.success.zeroRowSampleCount.toString()} blankViewportSamples=${probe.success.blankViewportSampleCount.toString()} maxEmpty=${probe.success.maxEmptyRowCount.toString()} genericExact=${probe.success.maxExactGenericToolRowCount.toString()} genericPrefix=${probe.success.maxPrefixGenericToolRowCount.toString()} rawProvider=${probe.success.maxRawProviderToolRowCount.toString()}`,
				`scroll height: initial=${probe.success.initialScrollHeightPx === null ? "unavailable" : probe.success.initialScrollHeightPx.toFixed(0)} final=${probe.success.finalScrollHeightPx === null ? "unavailable" : probe.success.finalScrollHeightPx.toFixed(0)} client=${probe.success.clientHeightPx === null ? "unavailable" : probe.success.clientHeightPx.toFixed(0)} max=${probe.success.maxScrollTopPx === null ? "unavailable" : probe.success.maxScrollTopPx.toFixed(0)}`,
			].concat(sampleSummary),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "agent-panel-scroll-page-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "ledger-backfill-probe") {
		const probe = await Effect.runPromise(
			Effect.result(
				probeLedgerBackfill({
					appIdentifier: options.appIdentifier,
					limit: Number.isFinite(options.limit) ? options.limit : 1,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "ledger-backfill-probe",
				status: "fail",
				summary: ["Unable to invoke warm_recent_transcript_row_ledgers in the WebView."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor and confirm the dev binary includes the ledger backfill command."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("ledger-backfill-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "ledger-backfill-probe",
			status: probe.success.failedCount === 0 ? "ok" : "warn",
			summary: [
				`limit: requested=${probe.success.requestedLimit.toString()} candidates=${probe.success.candidateCount.toString()} checked=${probe.success.checkedCount.toString()}`,
				`rebuilt: total=${probe.success.rebuiltCount.toString()} provider=${probe.success.rebuiltFromProviderCount.toString()}`,
				`skipped: upToDate=${probe.success.skippedCurrentCount.toString()} noJournal=${probe.success.skippedNoJournalCount.toString()} missingFacts=${probe.success.skippedMissingFactsCount.toString()}`,
				`failed: count=${probe.success.failedCount.toString()} ids=${probe.success.failedSessionIds.slice(0, 3).join(", ") || "none"}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "ledger-backfill-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return statusExitCode(result.status);
	}

	if (options.command === "observe") {
		const observation = await Effect.runPromise(
			Effect.result(
				observeApp({
					appIdentifier: options.appIdentifier,
					level: options.level,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(observation)) {
			const result = buildResult({
				command: "observe",
				status: "fail",
				summary: ["Unable to observe the Acepe WebView."],
				error: dependencyError(
					observation.failure.code,
					observation.failure.message,
					"Run acepe-qa doctor, then retry observe with the reported app port."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("observe", observation.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const summary = [
			`url: ${observation.success.url ?? "unknown"}`,
			`panels: ${observation.success.panelCount.toString()}`,
			`composer: ${observation.success.composer.present ? "present" : "missing"}`,
			`sessionCanSubmit: ${observation.success.composer.sessionCanSubmit === null ? "unknown" : observation.success.composer.sessionCanSubmit.toString()}`,
			`visible errors: ${observation.success.visibleSessionErrors.length.toString()}`,
			`refs: ${observation.success.refs.length.toString()}`,
		];
		const result = buildResult({
			command: "observe",
			status: observation.success.visibleSessionErrors.length > 0 ? "warn" : "ok",
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "observe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "screenshot") {
		const screenshot = await Effect.runPromise(
			Effect.result(
				screenshotApp({
					appIdentifier: options.appIdentifier,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(screenshot)) {
			const result = buildResult({
				command: "screenshot",
				status: "fail",
				summary: ["Unable to capture a WebView screenshot."],
				error: dependencyError(
					screenshot.failure.code,
					screenshot.failure.message,
					"Run acepe-qa doctor before taking screenshots."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("screenshot", screenshot.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "screenshot",
			status: "ok",
			summary: [`screenshot: ${screenshot.success.path}`],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "screenshot",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
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
		const inspection = await Effect.runPromise(
			Effect.result(
				inspectDom({
					appIdentifier: options.appIdentifier,
					selector: options.selector,
					limit: Number.isFinite(options.limit) ? options.limit : 10,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(inspection)) {
			const result = buildResult({
				command: "inspect",
				status: "fail",
				summary: ["Unable to inspect the Acepe WebView DOM."],
				error: dependencyError(
					inspection.failure.code,
					inspection.failure.message,
					"Run acepe-qa doctor, then retry inspect with a selector."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("inspect", inspection.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const summary = formatDomInspectionSummary(inspection.success);
		const result = buildResult({
			command: "inspect",
			status: "ok",
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "inspect",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
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
		const inspection = await Effect.runPromise(
			Effect.result(
				inspectShadowDom({
					appIdentifier: options.appIdentifier,
					hostSelector: options.hostSelector,
					selector: options.selector,
					limit: Number.isFinite(options.limit) ? options.limit : 10,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(inspection)) {
			const result = buildResult({
				command: "inspect-shadow",
				status: "fail",
				summary: ["Unable to inspect the Acepe WebView shadow DOM."],
				error: dependencyError(
					inspection.failure.code,
					inspection.failure.message,
					"Run acepe-qa doctor, then retry inspect-shadow with host and inner selectors."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("inspect-shadow", inspection.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "inspect-shadow",
			status: "ok",
			summary: formatDomInspectionSummary(inspection.success),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "inspect",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "planning-debug") {
		const debug = await Effect.runPromise(
			Effect.result(
				readPlanningDebug({
					appIdentifier: options.appIdentifier,
					sessionId: options.sessionId.length === 0 ? null : options.sessionId,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(debug)) {
			const result = buildResult({
				command: "planning-debug",
				status: "fail",
				summary: ["Unable to read planning-debug snapshots."],
				error: dependencyError(
					debug.failure.code,
					debug.failure.message,
					"Run acepe-qa doctor, then retry. The hook is installed once an agent panel mounts."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("planning-debug", debug.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const summary = debug.success.available
			? [
					`snapshots: ${debug.success.snapshots.length.toString()}`,
					...debug.success.snapshots.map(
						(snapshot) =>
							`- ${snapshot.sessionId ?? "null"} placeholderMode=${snapshot.localPlaceholderMode} | trailingCompletedTool=${snapshot.hasTrailingCompletedTool.toString()} optimistic=${snapshot.hasOptimisticPendingEntry} pendingSend=${snapshot.hasLocalPendingSendIntent} activity=${snapshot.activityKind ?? "null"} turn=${snapshot.turnState ?? "null"} lifecycle=${snapshot.lifecycleStatus ?? "null"} source=${snapshot.sourceKind ?? "null"} canSend=${snapshot.actionabilityCanSend === null ? "null" : snapshot.actionabilityCanSend.toString()} canSubmit=${snapshot.sessionCanSubmit.toString()} disableSend=${snapshot.disableSendForFailedFirstSend.toString()} entries=${snapshot.visibleEntryCount.toString()}`
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
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		process.stdout.write(formatCommandResult(result, options.format));
		return statusExitCode(result.status);
	}

	if (options.command === "computer-probe") {
		const sessionId = options.sessionId.length === 0 ? "acepe-computer-use-qa" : options.sessionId;
		const probe = await Effect.runPromise(
			Effect.result(
				probeComputerUse({
					appIdentifier: options.appIdentifier,
					sessionId,
					action: options.action,
					targetLabel: options.targetLabel,
					text: options.text,
					key: options.key,
					dx: options.dx,
					dy: options.dy,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "computer-probe",
				status: "fail",
				summary: ["Unable to invoke the Acepe computer-use probe."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor, then retry computer-probe against the dev app."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("computer-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const hasAction = probe.success.actionVerb !== null;
		const hasObservationFacts =
			probe.success.app !== null || probe.success.window !== null || probe.success.elementCount > 0;
		const actionChanged =
			probe.success.actionChangedCount !== null && probe.success.actionChangedCount > 0;
		const actionNeedsObservedChange = probe.success.actionVerb === "type";
		const actionSucceeded =
			hasAction && probe.success.actionOk === true && (!actionNeedsObservedChange || actionChanged);
		const observationSucceeded =
			!hasAction &&
			((probe.success.ok && hasObservationFacts) ||
				probe.success.errorCode === "computer_permission_required");
		const status = actionSucceeded || observationSucceeded ? "ok" : "warn";
		const baseSummary = [
			`server: ${probe.success.serverName}`,
			`tool: ${probe.success.toolName}`,
			`transport: ${probe.success.transport}`,
			`session: ${probe.success.sessionId}`,
			`ok: ${probe.success.ok ? "yes" : "no"}`,
			`isError: ${probe.success.isError ? "yes" : "no"}`,
			`app: ${probe.success.app ?? "none"}`,
			`window: ${probe.success.window ?? "none"}`,
			`elements: ${probe.success.elementCount.toString()}`,
			`observation facts: ${hasObservationFacts ? "present" : "empty"}`,
			`error: ${probe.success.errorCode ?? "none"}`,
			`permission: ${probe.success.permissionKind ?? "none"}`,
		];
		const actionSummary =
			probe.success.actionVerb === null
				? []
				: [
						`action: ${probe.success.actionVerb}`,
						`target label: ${probe.success.actionTargetLabel ?? "none"}`,
						`target id: ${probe.success.actionTargetId ?? "none"}`,
						`action ok: ${probe.success.actionOk === true ? "yes" : "no"}`,
						`action changed: ${probe.success.actionChangedCount === null ? "unknown" : probe.success.actionChangedCount.toString()}`,
						`action elements: ${probe.success.actionElementCount === null ? "unknown" : probe.success.actionElementCount.toString()}`,
						`action error: ${probe.success.actionErrorCode ?? "none"}`,
					];
		const result = buildResult({
			command: "computer-probe",
			status,
			summary: baseSummary.concat(actionSummary),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "computer-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "resize-probe") {
		const probe = await Effect.runPromise(
			Effect.result(
				probePanelResize({
					appIdentifier: options.appIdentifier,
					dx: options.dx ?? 220,
					steps: Number.isFinite(options.limit) ? options.limit : 24,
					stepDelayMs: Number.isFinite(options.delayMs) ? options.delayMs : 16,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "resize-probe",
				status: "fail",
				summary: ["Unable to run the panel resize probe."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor, then retry resize-probe against the dev app."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("resize-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const observedDelta =
			probe.success.observedDeltaBeforeRestore === null
				? "unknown"
				: probe.success.observedDeltaBeforeRestore.toFixed(1);
		const finalLag =
			probe.success.finalLagPx === null ? "unknown" : probe.success.finalLagPx.toFixed(1);
		const frameLag =
			probe.success.maxFrameLagPx === null ? "unknown" : probe.success.maxFrameLagPx.toFixed(1);
		const frameDelay =
			probe.success.maxFrameDelayMs === null ? "unknown" : probe.success.maxFrameDelayMs.toFixed(1);
		const avgFrameDelay =
			probe.success.avgFrameDelayMs === null ? "unknown" : probe.success.avgFrameDelayMs.toFixed(1);
		const status =
			!probe.success.found ||
			(probe.success.maxFrameDelayMs !== null && probe.success.maxFrameDelayMs > 32)
				? "warn"
				: "ok";
		const result = buildResult({
			command: "resize-probe",
			status,
			summary: [
				`found: ${probe.success.found ? "yes" : "no"}`,
				`requested dx: ${probe.success.requestedDelta.toString()}px over ${probe.success.steps.toString()} steps`,
				`width: ${probe.success.originalWidth === null ? "unknown" : probe.success.originalWidth.toFixed(1)}px -> ${probe.success.finalWidthBeforeRestore === null ? "unknown" : probe.success.finalWidthBeforeRestore.toFixed(1)}px before restore`,
				`observed delta: ${observedDelta}px`,
				`final lag: ${finalLag}px`,
				`max frame lag: ${frameLag}px`,
				`frame delay: avg=${avgFrameDelay}ms max=${frameDelay}ms`,
				`transition: ${probe.success.transitionProperty ?? "unknown"} duration=${probe.success.transitionDuration ?? "unknown"}`,
				`restored width: ${probe.success.restoredWidth === null ? "unknown" : probe.success.restoredWidth.toFixed(1)}px`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "resize-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "resize-stream-probe") {
		const probe = await Effect.runPromise(
			Effect.result(
				probePanelResizeStream({
					appIdentifier: options.appIdentifier,
					dx: options.dx ?? 220,
					durationMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 600,
					moveIntervalMs: Number.isFinite(options.delayMs) ? options.delayMs : 8,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "resize-stream-probe",
				status: "fail",
				summary: ["Unable to run the continuous panel resize probe."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor, then retry resize-stream-probe against the dev app."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("resize-stream-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const maxLag = probe.success.maxLagPx === null ? "unknown" : probe.success.maxLagPx.toFixed(1);
		const avgLag = probe.success.avgLagPx === null ? "unknown" : probe.success.avgLagPx.toFixed(1);
		const avgFrame =
			probe.success.avgFrameIntervalMs === null
				? "unknown"
				: probe.success.avgFrameIntervalMs.toFixed(1);
		const maxFrame =
			probe.success.maxFrameIntervalMs === null
				? "unknown"
				: probe.success.maxFrameIntervalMs.toFixed(1);
		const status =
			!probe.success.found || (probe.success.maxLagPx !== null && probe.success.maxLagPx > 24)
				? "warn"
				: "ok";
		const result = buildResult({
			command: "resize-stream-probe",
			status,
			summary: [
				`found: ${probe.success.found ? "yes" : "no"}`,
				`requested dx: ${probe.success.requestedDelta.toString()}px over ${probe.success.durationMs.toString()}ms`,
				`moves: ${probe.success.moveCount.toString()} every ${probe.success.moveIntervalMs.toString()}ms`,
				`frames: ${probe.success.frameCount.toString()} avg=${avgFrame}ms max=${maxFrame}ms over50=${probe.success.framesOver50Ms.toString()}`,
				`lag: avg=${avgLag}px max=${maxLag}px`,
				`width: ${probe.success.originalWidth === null ? "unknown" : probe.success.originalWidth.toFixed(1)}px -> ${probe.success.finalWidthBeforeRestore === null ? "unknown" : probe.success.finalWidthBeforeRestore.toFixed(1)}px before restore`,
				`transition: ${probe.success.transitionProperty ?? "unknown"} duration=${probe.success.transitionDuration ?? "unknown"}`,
				`restored width: ${probe.success.restoredWidth === null ? "unknown" : probe.success.restoredWidth.toFixed(1)}px`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "resize-stream-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "select-project") {
		if (options.panelId.length === 0 || options.projectPath.length === 0) {
			const result = buildResult({
				command: "select-project",
				status: "fail",
				summary: ["Missing --panel-id or --project-path."],
				error: dependencyError(
					"missing_project_target",
					"select-project needs an exact panel id and project path.",
					"Example: bun run qa select-project --panel-id=empty-state-panel --project-path=/repo/acepe"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const selection = await Effect.runPromise(
			Effect.result(
				selectPanelProject({
					appIdentifier: options.appIdentifier,
					panelId: options.panelId,
					projectPath: options.projectPath,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(selection)) {
			const result = buildResult({
				command: "select-project",
				status: "fail",
				summary: ["Unable to select the project in the Acepe WebView."],
				error: dependencyError(
					selection.failure.code,
					selection.failure.message,
					"Run acepe-qa doctor, then retry with an exact panel id and project path."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("select-project", selection.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "select-project",
			status: selection.success.selected ? "ok" : "fail",
			summary: [
				`panel: ${selection.success.panelId}`,
				`project path: ${selection.success.projectPath}`,
				`project name: ${selection.success.projectName ?? "missing"}`,
				`selected: ${selection.success.selected ? "yes" : "no"}`,
				`selected aria label: ${selection.success.selectedAriaLabel ?? "missing"}`,
				`error: ${selection.success.errorMessage ?? "none"}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "select-project",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: selection.success.selected
					? undefined
					: dependencyError(
							"project_selection_failed",
							selection.success.errorMessage ??
								"The project selection was not reflected in the target panel.",
							"Inspect the target panel project trigger and retry."
						),
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
		const click = await Effect.runPromise(
			Effect.result(
				clickWebview({
					appIdentifier: options.appIdentifier,
					selector: options.selector.length === 0 ? null : options.selector,
					text: options.text.length === 0 ? null : options.text,
					thenSelector: options.thenSelector.length === 0 ? null : options.thenSelector,
					thenText: options.thenText.length === 0 ? null : options.thenText,
					key: options.key.length === 0 ? null : options.key,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(click)) {
			const result = buildResult({
				command: "click",
				status: "fail",
				summary: ["Unable to click in the Acepe WebView."],
				error: dependencyError(
					click.failure.code,
					click.failure.message,
					"Run acepe-qa doctor, then retry click."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("click", click.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "click",
			status: click.success.clicked ? "ok" : "warn",
			summary: [
				`clicked: ${click.success.clicked ? "yes" : "no"}`,
				click.success.match === null
					? "match: none"
					: `match: ${click.success.match.tag} "${click.success.match.text.slice(0, 80)}"`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "click",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
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
		const hover = await Effect.runPromise(
			Effect.result(
				hoverWebview({
					appIdentifier: options.appIdentifier,
					selector: options.selector.length === 0 ? null : options.selector,
					afterSelector: options.afterSelector.length === 0 ? null : options.afterSelector,
					afterLimit: Number.isFinite(options.limit) ? options.limit : 10,
					text: options.text.length === 0 ? null : options.text,
					delayMs: options.delayMs,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(hover)) {
			const result = buildResult({
				command: "hover",
				status: "fail",
				summary: ["Unable to hover in the Acepe WebView."],
				error: dependencyError(
					hover.failure.code,
					hover.failure.message,
					"Run acepe-qa doctor, then retry hover."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("hover", hover.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "hover",
			status: hover.success.hovered ? "ok" : "warn",
			summary: [
				`hovered: ${hover.success.hovered ? "yes" : "no"}`,
				`css :hover: ${hover.success.matchesHoverPseudoClass ? "yes" : "no"}`,
				`native pointer: ${hover.success.pointerMoved ? "moved" : "not moved"}`,
				`sample delay: ${options.delayMs.toString()}ms`,
				hover.success.screenPoint === null
					? "screen point: none"
					: `screen point: ${hover.success.screenPoint.x.toFixed(1)}, ${hover.success.screenPoint.y.toFixed(1)}`,
				hover.success.match === null
					? "match: none"
					: `match: ${hover.success.match.tag} "${hover.success.match.text.slice(0, 80)}"`,
				hover.success.after === undefined || hover.success.after === null
					? "after: none"
					: `after: ${hover.success.after.count.toString()} matches for ${hover.success.after.selector}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "hover",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
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
		const navigation = await Effect.runPromise(
			Effect.result(
				navigateWebview({
					appIdentifier: options.appIdentifier,
					path: options.path,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(navigation)) {
			const result = buildResult({
				command: "navigate",
				status: "fail",
				summary: ["Unable to navigate the Acepe WebView."],
				error: dependencyError(
					navigation.failure.code,
					navigation.failure.message,
					"Run acepe-qa doctor, then retry navigate."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("navigate", navigation.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "navigate",
			status: "ok",
			summary: [
				`from: ${navigation.success.from}`,
				`to: ${navigation.success.to}`,
				`path: ${navigation.success.path}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "navigate",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "reload") {
		const reload = await Effect.runPromise(
			Effect.result(
				reloadWebview({
					appIdentifier: options.appIdentifier,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(reload)) {
			const result = buildResult({
				command: "reload",
				status: "fail",
				summary: ["Unable to reload the Acepe WebView."],
				error: dependencyError(
					reload.failure.code,
					reload.failure.message,
					"Run acepe-qa doctor, then retry reload."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("reload", reload.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "reload",
			status: "ok",
			summary: [`from: ${reload.success.from}`, `path: ${reload.success.path}`],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "reload",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "thinking-toggle-probe") {
		const probe = await Effect.runPromise(
			Effect.result(
				probeThinkingToggle({
					appIdentifier: options.appIdentifier,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "thinking-toggle-probe",
				status: "fail",
				summary: ["Unable to probe the thinking toggle."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor, then retry thinking-toggle-probe."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("thinking-toggle-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const summary = [
			`found: ${probe.success.found ? "yes" : "no"}`,
			`clicked: ${probe.success.clicked ? "yes" : "no"}`,
		].concat(
			probe.success.samples.map((sample) => {
				const content =
					sample.firstContentText === null ? "" : ` text="${sample.firstContentText.slice(0, 60)}"`;
				return `${sample.label}: expand=${sample.expandCount.toString()} collapse=${sample.collapseCount.toString()} content=${sample.contentCount.toString()} first=${sample.firstButtonName ?? "none"}${content}`;
			})
		);
		const result = buildResult({
			command: "thinking-toggle-probe",
			status: probe.success.samples.some(
				(sample) => sample.collapseCount > 0 && sample.contentCount > 0
			)
				? "ok"
				: "warn",
			summary,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "thinking-toggle-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "first-send-probe") {
		if (
			options.text.length === 0 ||
			options.panelId.length === 0 ||
			options.sessionId.length === 0
		) {
			const result = buildResult({
				command: "first-send-probe",
				status: "fail",
				summary: ["Missing --text, --panel-id, or --session-id."],
				error: dependencyError(
					"missing_first_send_probe_target",
					"first-send-probe needs prompt text and exact panel/session identity.",
					"Example: bun run qa first-send-probe --panel-id=<panel> --session-id=<session> --text='QA ping: reply ok'"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const probe = await Effect.runPromise(
			Effect.result(
				probeFirstSendTimeline({
					appIdentifier: options.appIdentifier,
					text: options.text,
					selector: options.selector,
					panelId: options.panelId,
					sessionId: options.sessionId,
					preScrollOffsetPx: options.preScrollOffsetPx,
					timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5_000,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "first-send-probe",
				status: "fail",
				summary: ["Unable to probe first-send timing."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor; ensure the target composer is visible."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("first-send-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const probeSummary = summarizeFirstSendProbe(probe.success);
		const result = buildResult({
			command: "first-send-probe",
			status: probeSummary.status,
			summary: probeSummary.lines,
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "first-send-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "composer-enter-probe") {
		if (
			options.text.length === 0 ||
			options.panelId.length === 0 ||
			options.sessionId.length === 0
		) {
			const result = buildResult({
				command: "composer-enter-probe",
				status: "fail",
				summary: ["Missing --text, --panel-id, or --session-id."],
				error: dependencyError(
					"missing_enter_probe_target",
					"composer-enter-probe needs prompt text and exact panel/session identity.",
					"Example: bun run qa composer-enter-probe --panel-id=<panel> --session-id=<session> --text='QA prompt'"
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const probe = await Effect.runPromise(
			Effect.result(
				probeComposerEnterSubmit({
					appIdentifier: options.appIdentifier,
					text: options.text,
					panelId: options.panelId,
					sessionId: options.sessionId,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "composer-enter-probe",
				status: "fail",
				summary: ["Unable to probe plain Enter submission."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run qa doctor and confirm the exact panel remains open."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("composer-enter-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const passed =
			probe.success.targetFound &&
			probe.success.composerFound &&
			probe.success.sendReadyBeforeEnter &&
			probe.success.enterDefaultPrevented &&
			!probe.success.newlineWouldBeInserted &&
			probe.success.draftAfterEnter.length === 0 &&
			probe.success.submittedUserRowFound;
		const result = buildResult({
			command: "composer-enter-probe",
			status: passed ? "ok" : "fail",
			summary: [
				`target: ${probe.success.targetFound ? "found" : "missing"}`,
				`composer: ${probe.success.composerFound ? "found" : "missing"}`,
				`send ready before Enter: ${probe.success.sendReadyBeforeEnter ? "yes" : "no"}`,
				`Enter default prevented: ${probe.success.enterDefaultPrevented ? "yes" : "no"}`,
				`browser newline default: ${probe.success.newlineWouldBeInserted ? "would run" : "blocked"}`,
				`submitted user row: ${probe.success.submittedUserRowFound ? "found" : "missing"}`,
				`lifecycle before/after: ${probe.success.planningBefore?.lifecycleStatus ?? "unknown"} -> ${probe.success.planningAfter?.lifecycleStatus ?? "unknown"}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "composer-enter-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
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

		const probe = await Effect.runPromise(
			Effect.result(
				probeSessionOpenContent({
					appIdentifier: options.appIdentifier,
					sessionId: options.sessionId,
					projectPath: options.projectPath,
					agentId: options.agentId,
					sourcePath: options.sourcePath.length === 0 ? null : options.sourcePath,
					title: options.title.length === 0 ? null : options.title,
					timeoutMs: options.timeoutMs,
					closeAfter: !options.keepOpen,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "session-open-content-probe",
				status: "fail",
				summary: ["Unable to probe session content open timing."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor; ensure the dev app contains the session-open QA hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("session-open-content-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const probeSummary = summarizeSessionOpenContentProbe(probe.success);
		const result = buildResult({
			command: "session-open-content-probe",
			status: probeSummary.status,
			summary: [
				`session: ${probe.success.sessionId} panel=${probe.success.panelId ?? "none"}`,
				`setup: knownBefore=${probe.success.sessionKnownBeforeOpen ? "yes" : "no"} placeholder=${probe.success.placeholderRegistered ? "yes" : "no"} closedExisting=${probe.success.closedExistingPanel ? "yes" : "no"}`,
				`foreground: start=${probe.success.documentVisibilityAtStart} focusStart=${probe.success.documentHasFocusAtStart ? "yes" : "no"} end=${probe.success.documentVisibilityAtEnd} focusEnd=${probe.success.documentHasFocusAtEnd ? "yes" : "no"} frameTiming=${probe.success.foregroundFrameTimingValid ? "valid" : "invalid"}`,
				`timing: select=${formatOptionalMs(probe.success.selectCallMs)} panelDom=${formatOptionalMs(probe.success.panelDomReadyMs)} viewport=${formatOptionalMs(probe.success.transcriptViewportReadyMs)} firstRowDom=${formatOptionalMs(probe.success.firstRowDomReadyMs)} firstRowPaint=${formatOptionalMs(probe.success.firstRowPaintMs)}`,
				`rows: firstPaint=${probe.success.rowCountAtFirstPaint.toString()} final=${probe.success.finalRowCount.toString()}`,
				`end state: closeAfter=${probe.success.closeAfterRequested ? "yes" : "no"} panelStore=${probe.success.panelStillOpenAtEnd ? "open" : "closed"} panelDom=${probe.success.panelDomPresentAtEnd ? "present" : "missing"} session=${probe.success.sessionKnownAtEnd ? "known" : "unknown"} canonical=${probe.success.sessionHasCanonicalProjectionAtEnd ? "yes" : "no"} lifecycle=${probe.success.sessionLifecycleStatusAtEnd ?? "none"} canSend=${probe.success.sessionCanSendAtEnd === null ? "unknown" : probe.success.sessionCanSendAtEnd ? "yes" : "no"} messages=${probe.success.sessionMessageCountAtEnd === null ? "unknown" : probe.success.sessionMessageCountAtEnd.toString()}`,
				`runtime errors: ${probe.success.runtimeErrors.length === 0 ? "none" : probe.success.runtimeErrors.slice(0, 3).join(" | ")}`,
				`tauri invokes: count=${probe.success.tauriInvokeTimings.length.toString()} top=${formatSessionOpenInvokeTopList(probe.success.tauriInvokeTimings, 6)}`,
				`pending tauri invokes: count=${probe.success.pendingTauriInvokes.length.toString()} top=${formatPendingInvokeTopList(probe.success.pendingTauriInvokes, 6)}`,
				`open events: count=${probe.success.openEvents.length.toString()} tail=${formatSessionOpenEvents(probe.success.openEvents, 8)}`,
				`hydration timings: count=${probe.success.hydrationTimings.length.toString()} top=${formatHydrationTimingTopList(probe.success.hydrationTimings, 3)}`,
				`panel open marks: ${formatPanelOpenMarks(probe.success.panelOpenMarks)}`,
				`frontend profile: samples=${probe.success.agentPanelPerformanceSamples.length.toString()} top=${formatAgentPanelPerformanceTopList(probe.success.agentPanelPerformanceSamples, 6)}`,
				probeSummary.backendLine,
				probeSummary.targetLine,
			].concat(probe.success.errorMessage === null ? [] : [`error: ${probe.success.errorMessage}`]),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "session-open-content-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "happy-path-perf") {
		const probe = await Effect.runPromise(
			Effect.result(
				probeHappyPathPerformance({
					appIdentifier: options.appIdentifier,
					timeoutMs: options.timeoutMs,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "happy-path-perf",
				status: "fail",
				summary: ["Unable to probe happy-path performance."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor; ensure the dev app contains the happy-path QA hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("happy-path-perf", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const leakedPanel =
			probe.success.app.panelCountAfter !== probe.success.app.panelCountBefore ||
			probe.success.app.domPanelCountAfter !== probe.success.app.domPanelCountBefore;
		const projectUnavailable = !probe.success.app.projectReady;
		const result = buildResult({
			command: "happy-path-perf",
			status: probe.success.hookAvailable && !leakedPanel && !projectUnavailable ? "ok" : "warn",
			summary: [
				`hook: ${probe.success.hookAvailable ? "available" : "missing"}`,
				`route: ${probe.success.route}`,
				`runtime errors: ${probe.success.runtimeErrors.length === 0 ? "none" : probe.success.runtimeErrors.slice(0, 3).join(" | ")}`,
				`timing env: ${probe.success.timingEnvironment.label}`,
				`navigation: type=${probe.success.navigation.type ?? "unknown"} domContentLoaded=${formatOptionalMs(probe.success.navigation.domContentLoadedMs)} load=${formatOptionalMs(probe.success.navigation.loadEventEndMs)} duration=${formatOptionalMs(probe.success.navigation.durationMs)}`,
				`shell ready: ready=${probe.success.app.shellReady ? "yes" : "no"} duration=${formatOptionalMs(probe.success.app.shellReadyDurationMs)} wait=${formatOptionalMs(probe.success.app.shellReadyWaitMs)}`,
				`app init: complete=${probe.success.app.initializationComplete ? "yes" : "no"} duration=${formatOptionalMs(probe.success.app.initializationDurationMs)} wait=${formatOptionalMs(probe.success.app.initializationWaitMs)}`,
				`project ready: ready=${probe.success.app.projectReady ? "yes" : "no"} wait=${formatOptionalMs(probe.success.app.projectReadyWaitMs)} projects=${probe.success.app.projectCountAtPanelCreate.toString()}`,
				`panel open: create=${formatOptionalMs(probe.success.openClose.panelCreateMs)} dom=${formatOptionalMs(probe.success.openClose.panelDomReadyMs)} composer=${formatOptionalMs(probe.success.openClose.composerReadyAfterCreateMs)}`,
				`panel open marked: preMark=${formatOptionalMs(probe.success.openClose.panelPreMarkDelayMs)} markedWork=${formatOptionalMs(probe.success.openClose.panelMarkedWorkMs)} domAfterMark=${formatOptionalMs(probe.success.openClose.panelDomReadyAfterLastMarkMs)} composerAfterMark=${formatOptionalMs(probe.success.openClose.composerReadyAfterLastMarkMs)}`,
				`panel open detail: afterCreate=${probe.success.openClose.panelDomPresentAfterCreate ? "yes" : "no"} mutation=${formatOptionalMs(probe.success.openClose.panelDomMutationMs)} afterFlush=${formatOptionalMs(probe.success.openClose.panelDomAfterDomFlushMs)} afterFrame=${formatOptionalMs(probe.success.openClose.panelDomAfterFirstFrameMs)} composerMutation=${formatOptionalMs(probe.success.openClose.composerMutationMs)} composerWait=${formatOptionalMs(probe.success.openClose.composerReadyMs)}`,
				`panel open marks: ${formatPanelOpenMarks(probe.success.openClose.panelOpenMarks)}`,
				`panel open dom: nodes=${probe.success.openClose.panelDomNodeCount.toString()} rows=${probe.success.openClose.panelRowNodeCount.toString()} dropdownContent=${probe.success.openClose.panelDropdownContentNodeCount.toString()} resizeObservers=${formatOptionalCount(probe.success.openClose.resizeObserverConstructCount)} observe=${formatOptionalCount(probe.success.openClose.resizeObserverObserveCount)} callbacks=${formatOptionalCount(probe.success.openClose.resizeObserverCallbackCount)}`,
				`panel close: call=${formatOptionalMs(probe.success.openClose.closeCallReturnMs)} microtask=${formatOptionalMs(probe.success.openClose.closeMicrotaskMs)} frame=${formatOptionalMs(probe.success.openClose.closeFirstFrameMs)} gone=${formatOptionalMs(probe.success.openClose.closeDomGoneMs)} total=${formatOptionalMs(probe.success.openClose.totalMs)}`,
				`panel close dom: microtask=${probe.success.openClose.closeDomGoneAfterMicrotask ? "gone" : "present"} firstFrame=${probe.success.openClose.closeDomGoneAfterFirstFrame ? "gone" : "present"}`,
				`panel counts: store ${probe.success.app.panelCountBefore.toString()} -> ${probe.success.app.panelCountAfter.toString()}, dom ${probe.success.app.domPanelCountBefore.toString()} -> ${probe.success.app.domPanelCountAfter.toString()}`,
			]
				.concat(formatPanelCloseTraceSummary(probe.success))
				.concat(formatProjectLoadTraceSummary(probe.success))
				.concat(formatTauriInvokeSummary(probe.success))
				.concat(formatStartupTraceSummary(probe.success)),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "happy-path-perf",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "streaming-repro-lab") {
		const lab = await Effect.runPromise(
			Effect.result(
				openStreamingReproLab({
					appIdentifier: options.appIdentifier,
					delayMs: Number.isFinite(options.delayMs) ? options.delayMs : 300,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(lab)) {
			const result = buildResult({
				command: "streaming-repro-lab",
				status: "fail",
				summary: ["Unable to open the Streaming Repro Lab."],
				error: dependencyError(
					lab.failure.code,
					lab.failure.message,
					"Run acepe-qa doctor; ensure the dev app contains the streaming repro QA hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("streaming-repro-lab", lab.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const streamingPerfLines =
			lab.success.performance === null
				? ["stream perf: unavailable"]
				: (() => {
						const steps = lab.success.performance.steps;
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
							`stream perf: phases=${lab.success.performance.phaseCount.toString()} total=${formatOptionalMs(lab.success.performance.totalMs)}`,
							`stream env: ${lab.success.performance.visibilityState} focus=${lab.success.performance.documentHasFocus === null ? "unknown" : lab.success.performance.documentHasFocus ? "yes" : "no"}`,
							`stream slowest flush: phase=${slowest.phaseId} flush=${formatOptionalMs(slowest.domFlushMs)} rows=${slowest.rowCount.toString()} chars=${slowest.assistantTextLength.toString()} animated=${slowest.animatedTokenSpans.toString()}`,
						];
					})();
		const result = buildResult({
			command: "streaming-repro-lab",
			status:
				lab.success.hookAvailable && lab.success.opened && lab.success.labPresent ? "ok" : "warn",
			summary: [
				`hook: ${lab.success.hookAvailable ? "available" : "missing"}`,
				`opened: ${lab.success.opened ? "yes" : "no"}`,
				`lab: ${lab.success.labPresent ? "present" : "missing"}`,
				`phase: ${lab.success.phaseLabel ?? "none"}`,
				`token reveal mode: ${lab.success.tokenRevealMode ?? "none"}`,
				`animated token spans: ${lab.success.tokenRevealAnimatedCount.toString()}`,
			].concat(streamingPerfLines),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "streaming-repro-lab",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "agent-panel-stress-lab" || options.command === "stress-lab") {
		const rowCount = Number.isFinite(options.rows) ? options.rows : 1_000;
		const seed = Number.isFinite(options.seed) ? options.seed : 1;
		const lab = await Effect.runPromise(
			Effect.result(
				openAgentPanelStressLab({
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
				})
			)
		);
		if (Result.isFailure(lab)) {
			const result = buildResult({
				command: options.command,
				status: "fail",
				summary: ["Unable to run the Agent Panel Stress Lab."],
				error: dependencyError(
					lab.failure.code,
					lab.failure.message,
					"Run acepe-qa doctor; ensure the dev app contains the agent panel stress QA hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("agent-panel-stress-lab", lab.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const rowLabel =
			lab.success.rowCount === null ? "unknown" : lab.success.rowCount.toLocaleString();
		const domRowLabel =
			lab.success.domRowCount === null ? "unknown" : lab.success.domRowCount.toLocaleString();
		const measurementWarningLines = agentPanelStressLabMeasurementWarnings(lab.success).map(
			(warning) => `measurement warning: ${warning}`
		);
		const profilePhaseLines =
			lab.success.dump === null
				? ["profile: unavailable"]
				: lab.success.dump.profileSummary.phases.slice(0, 5).map((phase) => {
						const maxItems =
							phase.maxItemCount === null ? "n/a" : phase.maxItemCount.toLocaleString();
						return `profile: ${phase.phase} total=${formatOptionalMs(phase.totalDurationMs)} max=${formatOptionalMs(phase.maxDurationMs)} count=${phase.count.toString()} items=${maxItems}`;
					});
		const scrollUpdateLine =
			lab.success.dump === null
				? "scroll update: unavailable"
				: `scroll update: samples=${lab.success.dump.summary.scrollUpdateSampleCount.toString()} avg=${formatOptionalMs(lab.success.dump.summary.averageScrollUpdateMs)} max=${formatOptionalMs(lab.success.dump.summary.maxScrollUpdateMs)} maxDomRows=${lab.success.dump.summary.maxScrollUpdateDomRowCount === null ? "unavailable" : lab.success.dump.summary.maxScrollUpdateDomRowCount.toLocaleString()}`;
		const scrollChurnLine =
			lab.success.dump === null
				? "scroll churn: unavailable"
				: `scroll churn: maxMounted=${lab.success.dump.summary.maxScrollUpdateMountedRowCount === null ? "unavailable" : lab.success.dump.summary.maxScrollUpdateMountedRowCount.toLocaleString()} maxUnmounted=${lab.success.dump.summary.maxScrollUpdateUnmountedRowCount === null ? "unavailable" : lab.success.dump.summary.maxScrollUpdateUnmountedRowCount.toLocaleString()} maxCold=${lab.success.dump.summary.maxFrameColdRevealedRowCount === null ? "unavailable" : lab.success.dump.summary.maxFrameColdRevealedRowCount.toLocaleString()} maxStaticErr=${formatOptionalMs(lab.success.dump.summary.maxFrameStaticEstimateErrorPx)} profileMax=${formatOptionalMs(lab.success.dump.summary.maxScrollUpdateProfileDurationMs)} phase=${lab.success.dump.summary.maxScrollUpdateProfileSlowestPhase ?? "unavailable"}`;
		const frameBudgetLine =
			lab.success.dump === null
				? "frame budget: unavailable"
				: `frame budget: target=${formatOptionalMs(lab.success.dump.summary.targetFrameBudgetMs)} missed120=${lab.success.dump.summary.missed120HzFrameCount.toString()} maxOver=${formatOptionalMs(lab.success.dump.summary.maxFrameBudgetOverrunMs)}`;
		const slowestFrameLine =
			lab.success.dump === null
				? "slowest frame: unavailable"
				: `slowest frame: index=${lab.success.dump.summary.slowestFrameIndex === null ? "unavailable" : lab.success.dump.summary.slowestFrameIndex.toString()} delta=${formatOptionalMs(lab.success.dump.summary.slowestFrameDeltaMs)} cause=${lab.success.dump.summary.slowestFrameCause ?? "unavailable"} profile=${formatOptionalMs(lab.success.dump.summary.slowestFrameProfileDurationMs)} browser=${formatOptionalMs(lab.success.dump.summary.slowestFrameBrowserRenderMs)} prevBrowser=${formatOptionalMs(lab.success.dump.summary.slowestFramePreviousBrowserRenderMs)} preGap=${formatOptionalMs(lab.success.dump.summary.slowestFramePreFrameGapMs)} mounted=${lab.success.dump.summary.slowestFrameMountedRowCount === null ? "unavailable" : lab.success.dump.summary.slowestFrameMountedRowCount.toString()} unmounted=${lab.success.dump.summary.slowestFrameUnmountedRowCount === null ? "unavailable" : lab.success.dump.summary.slowestFrameUnmountedRowCount.toString()} cold=${lab.success.dump.summary.slowestFrameColdRevealedRowCount === null ? "unavailable" : lab.success.dump.summary.slowestFrameColdRevealedRowCount.toString()} static=${lab.success.dump.summary.slowestFrameStaticEstimateRowCount === null ? "unavailable" : lab.success.dump.summary.slowestFrameStaticEstimateRowCount.toString()} measured=${lab.success.dump.summary.slowestFrameMeasuredEstimateRowCount === null ? "unavailable" : lab.success.dump.summary.slowestFrameMeasuredEstimateRowCount.toString()} maxErr=${formatOptionalMs(lab.success.dump.summary.slowestFrameMaxStaticEstimateErrorPx)} avgErr=${formatOptionalMs(lab.success.dump.summary.slowestFrameAverageStaticEstimateErrorPx)} rows=${lab.success.dump.summary.slowestFrameDomRowCount === null ? "unavailable" : lab.success.dump.summary.slowestFrameDomRowCount.toString()}`;
		const result = buildResult({
			command: options.command,
			status: agentPanelStressLabStatus(lab.success),
			summary: [
				`hook: ${lab.success.hookAvailable ? "available" : "missing"}`,
				`opened: ${lab.success.opened ? "yes" : "no"}`,
				`lab: ${lab.success.labPresent ? "present" : "missing"}`,
				`scenario: rows=${rowLabel} preset=${lab.success.preset ?? "unknown"} renderer=${lab.success.rendererMode ?? "unknown"} seed=${lab.success.seed?.toString() ?? "unknown"}`,
				`DOM rows: ${domRowLabel}`,
				`render settle: ${formatOptionalMs(lab.success.renderSettleMs)}`,
				`scroll: bottom=${formatOptionalMs(lab.success.scrollToBottomMs)} top=${formatOptionalMs(lab.success.scrollToTopMs)}`,
				`frames: samples=${lab.success.frameSampleCount.toString()} jank=${lab.success.jankFrameCount.toString()} avg=${formatOptionalMs(lab.success.averageFrameDeltaMs)} max=${formatOptionalMs(lab.success.maxFrameDeltaMs)}`,
				`frame env: ${lab.success.frameEnvironmentLabel ?? "unavailable"}`,
				`frame throttle: ${lab.success.frameSamplingLikelyThrottled === null ? "unknown" : lab.success.frameSamplingLikelyThrottled ? "likely" : "no"}`,
				`estimated fps: ${lab.success.estimatedFps === null ? "unavailable" : lab.success.estimatedFps.toFixed(2)}`,
				frameBudgetLine,
				slowestFrameLine,
				scrollUpdateLine,
				scrollChurnLine,
				`memory: ${lab.success.memoryLabel ?? "unavailable"}`,
			]
				.concat(measurementWarningLines)
				.concat(profilePhaseLines),
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "agent-panel-stress-lab",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "planning-between-tools-probe") {
		const probe = await Effect.runPromise(
			Effect.result(
				probePlanningBetweenTools({
					appIdentifier: options.appIdentifier,
					delayMs: Number.isFinite(options.delayMs) ? options.delayMs : 300,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "planning-between-tools-probe",
				status: "fail",
				summary: ["Unable to run the provider-free planning-between-tools probe."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor; ensure the dev app contains the planning-between-tools stress hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const completedToolSample = probe.success.samples.find(
			(sample) => sample.stage === "completed_tool_tail"
		);
		const activeAssistantSample = probe.success.samples.find(
			(sample) => sample.stage === "active_assistant_tail"
		);
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("planning-between-tools-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "planning-between-tools-probe",
			status: probe.success.passed ? "ok" : "fail",
			summary: [
				`hook: ${probe.success.hookAvailable ? "available" : "missing"}`,
				`opened: ${probe.success.opened ? "yes" : "no"} lab=${probe.success.labPresent ? "present" : "missing"}`,
				completedToolSample === undefined
					? "stage A: missing"
					: `stage A: tail=${completedToolSample.trailingRowKind === null ? "none" : completedToolSample.trailingRowKind} mode=${completedToolSample.localPlaceholderMode} planning=${completedToolSample.planningRowCount.toString()} visible=${completedToolSample.planningVisible ? "yes" : "no"}`,
				activeAssistantSample === undefined
					? "stage B: missing"
					: `stage B: tail=${activeAssistantSample.trailingRowKind === null ? "none" : activeAssistantSample.trailingRowKind} active=${activeAssistantSample.activeStreamingTail === null ? "none" : activeAssistantSample.activeStreamingTail} mode=${activeAssistantSample.localPlaceholderMode} planning=${activeAssistantSample.planningRowCount.toString()}`,
				`restored completed-tool stage: ${probe.success.restoredCompletedToolStage ? "yes" : "no"}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "planning-between-tools-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "send-attach-stress-probe") {
		const rowCount = Number.isFinite(options.rows) ? options.rows : 120;
		const preScrollOffsetPx =
			options.preScrollOffsetPx === null ? 2_000 : options.preScrollOffsetPx;
		const probe = await Effect.runPromise(
			Effect.result(
				probeSendAttachStress({
					appIdentifier: options.appIdentifier,
					rowCount,
					preScrollOffsetPx,
					delayMs: Number.isFinite(options.delayMs) ? options.delayMs : 300,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "send-attach-stress-probe",
				status: "fail",
				summary: ["Unable to run the provider-free send attach stress probe."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Run acepe-qa doctor; ensure the dev app contains the send attach stress hook."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		let maxPostSendDfbPx = 0;
		let maxPlaceholderCount = 0;
		let maxSpacerCount = 0;
		let longRowHeightPx = 0;
		for (const sample of probe.success.samples) {
			if (sample.label !== "pre-send") {
				maxPostSendDfbPx = Math.max(maxPostSendDfbPx, sample.distFromBottomPx);
			}
			maxPlaceholderCount = Math.max(maxPlaceholderCount, sample.placeholderCount);
			maxSpacerCount = Math.max(maxSpacerCount, sample.spacerCount);
			longRowHeightPx = Math.max(longRowHeightPx, sample.longMarkdownHeightPx);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("send-attach-stress-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "send-attach-stress-probe",
			status: probe.success.passed ? "ok" : "fail",
			summary: [
				`hook: ${probe.success.hookAvailable ? "available" : "missing"}`,
				`opened: ${probe.success.opened ? "yes" : "no"} lab=${probe.success.labPresent ? "present" : "missing"}`,
				`scenario: requestedRows=${probe.success.requestedRowCount.toString()} finalRows=${probe.success.rowCount.toString()} preScroll=${probe.success.requestedPreScrollOffsetPx.toString()}px`,
				`precondition: ${probe.success.preconditionPassed ? "passed" : "failed"}`,
				`post-send: maxDfb=${Math.round(maxPostSendDfbPx).toString()}px nativeClamp=${probe.success.nativeClampDetected ? "yes" : "no"}`,
				`extent collapse: ${Math.round(probe.success.maxExtentCollapsePx).toString()}px`,
				`stable row shell: ${probe.success.stableRowShellPreserved ? "preserved" : "replaced"}`,
				`long NativeMarkdown row: ${Math.round(longRowHeightPx).toString()}px`,
				`placeholder/spacer max: ${maxPlaceholderCount.toString()}/${maxSpacerCount.toString()}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "send-attach-stress-probe",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
				: undefined,
		});
		return emitVerifiedUiResult(options, result);
	}

	if (options.command === "hmr-ui-probe") {
		const probe = await Effect.runPromise(
			Effect.result(
				probeUiPackageHmr({
					checkoutRoot: options.checkoutRoot,
					viteDevUrl: options.path.length > 0 ? options.path : undefined,
					timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12_000,
				})
			)
		);
		if (Result.isFailure(probe)) {
			const result = buildResult({
				command: "hmr-ui-probe",
				status: "fail",
				summary: ["Unable to probe @acepe/ui HMR."],
				error: dependencyError(
					probe.failure.code,
					probe.failure.message,
					"Start bun tauri dev, restart after vite.config alias changes, then rerun bun run qa hmr-ui-probe."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("hmr-ui-probe", probe.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const value = probe.success;
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
		const reset = await Effect.runPromise(
			Effect.result(
				resetOnboarding({
					appIdentifier: options.appIdentifier,
					delayMs: Number.isFinite(options.delayMs) ? options.delayMs : 300,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(reset)) {
			const result = buildResult({
				command: "reset-onboarding",
				status: "fail",
				summary: ["Unable to reset onboarding in the Acepe WebView."],
				error: dependencyError(
					reset.failure.code,
					reset.failure.message,
					"Run acepe-qa doctor, then retry reset-onboarding."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("reset-onboarding", reset.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "reset-onboarding",
			status:
				reset.success.clickedDevTools && reset.success.clickedReset && reset.success.hasWelcome
					? "ok"
					: "warn",
			summary: [
				`dev tools: ${reset.success.clickedDevTools ? "clicked" : "missing"}`,
				`reset: ${reset.success.clickedReset ? "clicked" : "missing"}`,
				`welcome: ${reset.success.hasWelcome ? "visible" : "missing"}`,
				`panels: ${reset.success.panelCount.toString()}`,
				`animated: ${reset.success.animated.length.toString()}`,
			],
			artifactPath,
			artifactKind: artifactPath === undefined ? undefined : "reset-onboarding",
			error: Result.isFailure(artifact)
				? dependencyError(
						artifact.failure.code,
						artifact.failure.message,
						"Check /tmp permissions."
					)
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
		const send = await Effect.runPromise(
			Effect.result(
				sendComposer({
					appIdentifier: options.appIdentifier,
					text: options.text,
					selector: options.selector,
					selectorIndex: options.selectorIndex,
					panelId: options.panelId,
					sessionId: options.sessionId,
					submit: !options.noSubmit,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(send)) {
			const result = buildResult({
				command: "send",
				status: "fail",
				summary: ["Unable to send via the composer."],
				error: dependencyError(
					send.failure.code,
					send.failure.message,
					"Run acepe-qa doctor; ensure a sendable session is open."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("send", send.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const result = buildResult({
			command: "send",
			status: send.success.sent ? "ok" : "warn",
			summary: [
				`composer: ${send.success.composerFound ? "found" : "missing"}`,
				`send ready: ${send.success.sendReady ? "yes" : "no"}`,
				`sent: ${send.success.sent ? "yes" : "no"}`,
				`text: "${send.success.textApplied.slice(0, 60)}"`,
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
		const watch = await Effect.runPromise(
			Effect.result(
				watchForVisibleText({
					appIdentifier: options.appIdentifier,
					text: options.text,
					timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20_000,
					skipDriver: options.skipDriver,
				})
			)
		);
		if (Result.isFailure(watch)) {
			const result = buildResult({
				command: "watch",
				status: "fail",
				summary: ["Unable to watch the Acepe WebView."],
				error: dependencyError(
					watch.failure.code,
					watch.failure.message,
					"Run acepe-qa doctor, then retry watch."
				),
			});
			process.stdout.write(formatCommandResult(result, options.format));
			return statusExitCode(result.status);
		}
		const artifact = await Effect.runPromise(
			Effect.result(writeJsonArtifact("watch", watch.success))
		);
		const artifactPath = Result.isSuccess(artifact) ? artifact.success : undefined;
		const m = watch.success.matched;
		const result = buildResult({
			command: "watch",
			// warn (not fail) when present-but-hidden: that's a real, reportable finding.
			status: watch.success.visible ? "ok" : "warn",
			summary: [
				`text: "${watch.success.text.slice(0, 60)}"`,
				`present in dom: ${watch.success.presentInDom ? "yes" : "no"}`,
				`visible: ${watch.success.visible ? "yes" : "no"}`,
				watch.success.firstVisibleAtMs === null
					? "first visible: never"
					: `first visible: ${watch.success.firstVisibleAtMs.toString()}ms`,
				`elapsed: ${watch.success.elapsedMs.toString()}ms${watch.success.timedOut ? " (timed out)" : ""}`,
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
			"Use doctor, focus-app, frame-rate-probe, agent-panel-row-scan, agent-panel-scroll-page-probe, observe, screenshot, navigate, inspect, click, hover, thinking-toggle-probe, first-send-probe, happy-path-perf, streaming-repro-lab, agent-panel-stress-lab, planning-between-tools-probe, hmr-ui-probe, send, watch, or reset-onboarding."
		),
	});
	process.stdout.write(formatCommandResult(result, options.format));
	return statusExitCode(result.status);
}
