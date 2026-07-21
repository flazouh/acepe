import { err, okAsync, ResultAsync } from "neverthrow";
import { dispatchWebviewClick } from "./click-event-dispatch";
import { moveNativePointer, type NativePointerMover } from "./native-pointer";
import type {
	AgentPanelRowScanResult,
	AgentPanelScrollPageProbeResult,
	AgentPanelStressLabResult,
	AgentPanelStressLabRunStatus,
	ClickResult,
	ComposerEnterSubmitProbeResult,
	ComputerUseProbeResult,
	DomInspectionResult,
	FirstSendTimelineProbeResult,
	FocusAppResult,
	FrameRateProbeResult,
	HappyPathPerformanceResult,
	HoverResult,
	LedgerBackfillProbeResult,
	NavigateResult,
	PanelProjectSelectionResult,
	PlanningBetweenToolsProbeResult,
	PlanningDebugResult,
	ResetOnboardingResult,
	ResizeProbeResult,
	ResizeStreamProbeResult,
	SendAttachStressProbeResult,
	SendComposerResult,
	SessionOpenContentProbeResult,
	SessionOpenContentProbeRunStatus,
	StreamingReproLabResult,
	ThinkingToggleProbeResult,
	WatchResult,
} from "./schemas";
import {
	agentPanelRowScanResultSchema,
	agentPanelScrollPageProbeResultSchema,
	agentPanelStressLabRunStatusSchema,
	clickResultSchema,
	composerEnterSubmitProbeResultSchema,
	computerUseProbeResultSchema,
	domInspectionResultSchema,
	firstSendTimelineProbeResultSchema,
	focusAppResultSchema,
	frameRateProbeResultSchema,
	happyPathPerformanceResultSchema,
	hoverResultSchema,
	hoverTargetResultSchema,
	ledgerBackfillProbeResultSchema,
	navigateResultSchema,
	panelProjectSelectionResultSchema,
	planningBetweenToolsProbeResultSchema,
	planningDebugResultSchema,
	resetOnboardingResultSchema,
	resizeProbeResultSchema,
	resizeStreamProbeResultSchema,
	sendAttachStressProbeResultSchema,
	sendComposerResultSchema,
	sessionOpenContentProbeRunStatusSchema,
	streamingReproLabResultSchema,
	thinkingToggleProbeResultSchema,
	watchResultSchema,
} from "./schemas";
import {
	type CommandRunner,
	executeWebviewJson,
	executeWebviewJsonSync,
	runCommand,
	startDriverSession,
	type TauriMcpFailure,
} from "./tauri-mcp";

export type DriverOptions = {
	readonly appIdentifier: string;
	readonly runner?: CommandRunner;
	readonly skipDriver?: boolean;
};

function escapedJson(value: string): string {
	return JSON.stringify(value);
}

function driverReady(options: DriverOptions): ResultAsync<null, TauriMcpFailure> {
	const runner = options.runner === undefined ? runCommand : options.runner;
	const driver =
		options.skipDriver === true
			? okAsync({ code: 0, stdout: "", stderr: "" })
			: startDriverSession(options.appIdentifier, runner);
	return driver.andThen((session) => {
		if (session.code !== 0) {
			return err({
				code: "driver_session_failed",
				message:
					session.stderr.trim() || session.stdout.trim() || "Unable to start Tauri driver session.",
			});
		}
		return okAsync(null);
	});
}

function focusAppScript(): string {
	return `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let tauriActivateAttempted = false;
  let tauriActivateOk = false;
  let tauriActivateError = null;
  let windowFocusAttempted = false;
  let windowFocusOk = false;
  let windowFocusError = null;
  let windowRaiseAttempted = false;
  let windowRaiseOk = false;
  let windowRaiseError = null;
  let windowVisible = null;
  let windowMinimized = null;
  let windowFocused = null;
  let windowOuterWidth = null;
  let windowOuterHeight = null;
  let windowStateError = null;

  const tauriCore = window.__TAURI__ && window.__TAURI__.core;
  if (tauriCore && typeof tauriCore.invoke === "function") {
    tauriActivateAttempted = true;
    await tauriCore.invoke("activate_window", { label: "main" }).then(() => {
      tauriActivateOk = true;
    }, (error) => {
      tauriActivateError = error && typeof error.message === "string" ? error.message : String(error);
    });
  }
  const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
  const currentWindow =
    tauriWindow &&
    typeof tauriWindow.getCurrentWindow === "function" &&
    tauriWindow.getCurrentWindow();
  if (currentWindow) {
    const raiseErrors = [];
    if (typeof currentWindow.show === "function") {
      windowRaiseAttempted = true;
      await currentWindow.show().then(() => {
        windowRaiseOk = true;
      }, (error) => {
        raiseErrors.push(error && typeof error.message === "string" ? error.message : String(error));
      });
    }
    if (typeof window.focus === "function") {
      windowRaiseAttempted = true;
      window.focus();
      windowRaiseOk = true;
    }
    windowRaiseError = raiseErrors.length === 0 ? null : raiseErrors.join("; ");
  }
  if (currentWindow && typeof currentWindow.setFocus === "function") {
    windowFocusAttempted = true;
    await currentWindow.setFocus().then(() => {
      windowFocusOk = true;
    }, (error) => {
      windowFocusError = error && typeof error.message === "string" ? error.message : String(error);
    });
  }

  await sleep(300);
  if (currentWindow) {
    if (typeof currentWindow.isVisible === "function") {
      await currentWindow.isVisible().then((value) => {
        windowVisible = value === true;
      }, (error) => {
        windowStateError = error && typeof error.message === "string" ? error.message : String(error);
      });
    }
    if (typeof currentWindow.isMinimized === "function") {
      await currentWindow.isMinimized().then((value) => {
        windowMinimized = value === true;
      }, (error) => {
        windowStateError = error && typeof error.message === "string" ? error.message : String(error);
      });
    }
    if (typeof currentWindow.isFocused === "function") {
      await currentWindow.isFocused().then((value) => {
        windowFocused = value === true;
      }, (error) => {
        windowStateError = error && typeof error.message === "string" ? error.message : String(error);
      });
    }
    if (typeof currentWindow.outerSize === "function") {
      await currentWindow.outerSize().then((size) => {
        windowOuterWidth = Number.isFinite(size.width) ? size.width : null;
        windowOuterHeight = Number.isFinite(size.height) ? size.height : null;
      }, (error) => {
        windowStateError = error && typeof error.message === "string" ? error.message : String(error);
      });
    }
  }
  const documentVisibilityState = typeof document !== "undefined" ? document.visibilityState : null;
  const documentHasFocus =
    typeof document !== "undefined" && typeof document.hasFocus === "function"
      ? document.hasFocus()
      : null;
  const route = typeof window !== "undefined" ? window.location.pathname : null;
  const focused = documentVisibilityState === "visible" && documentHasFocus === true;
  return {
    route,
    documentVisibilityState,
    documentHasFocus,
    windowVisible,
    windowMinimized,
    windowFocused,
    windowOuterWidth,
    windowOuterHeight,
    windowStateError,
    tauriActivateAttempted,
    tauriActivateOk,
    tauriActivateError,
    windowFocusAttempted,
    windowFocusOk,
    windowFocusError,
    windowRaiseAttempted,
    windowRaiseOk,
    windowRaiseError,
    message: focused
      ? "Acepe WebView reports visible and focused."
      : "Acepe WebView did not report foreground focus.",
  };
})()
`;
}

export function focusDevApp(options: DriverOptions): ResultAsync<FocusAppResult, TauriMcpFailure> {
	return driverReady(options).andThen(() =>
		executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script: focusAppScript(),
				schema: focusAppResultSchema,
				callTimeoutMs: 8_000,
			},
			options.runner
		)
	);
}

function frameRateProbeScript(options: {
	readonly sampleCount: number;
	readonly selector: string;
	readonly selectorIndex: number;
	readonly collectRowChurn: boolean;
	readonly collectAgentPanelProfile: boolean;
	readonly scrollStepPx: number | null;
}): string {
	return `
	(async () => {
	  const sampleCount = ${options.sampleCount.toString()};
	  const selector = ${escapedJson(options.selector)};
	  const selectorIndex = ${Math.max(0, Math.floor(options.selectorIndex)).toString()};
	  const collectRowChurn = ${options.collectRowChurn ? "true" : "false"};
	  const collectAgentPanelProfile = ${options.collectAgentPanelProfile ? "true" : "false"};
	  const scrollStepPx = ${options.scrollStepPx === null ? "null" : options.scrollStepPx.toString()};
	  const frameDeltasMs = [];
	  const rowChurnSamples = [];
	  const visualSignatureByRowId = new Map();
	  let visualChangeCount = 0;
	  const visualChanges = [];
  let rafWaitCount = 0;
  let timeoutWaitCount = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const focusProbeWindow = async () => {
    const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
    const currentWindow =
      tauriWindow &&
      typeof tauriWindow.getCurrentWindow === "function" &&
      tauriWindow.getCurrentWindow();
    if (currentWindow && typeof currentWindow.show === "function") {
      await currentWindow.show().then(() => undefined, () => undefined);
    }
    if (typeof window.focus === "function") {
      window.focus();
    }
    if (currentWindow && typeof currentWindow.setFocus === "function") {
      await currentWindow.setFocus().then(() => undefined, () => undefined);
    }
    await sleep(150);
  };
  await focusProbeWindow();
	  const initialVisibilityState =
	    typeof document !== "undefined" ? document.visibilityState : null;
	  const effectiveSampleCount =
	    initialVisibilityState !== "visible"
	      ? Math.min(sampleCount, 1)
	      : sampleCount;
	
	  const waitForNextFrame = () => new Promise((resolve) => {
    let settled = false;
    const finishWithTimeout = () => {
      if (settled) {
        return;
      }
      settled = true;
      timeoutWaitCount += 1;
      resolve({ timeMs: performance.now(), source: "timeout" });
    };
    const timeoutId = setTimeout(() => finishWithTimeout(), 50);
    const finishWithRaf = (timeMs) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      rafWaitCount += 1;
      resolve({ timeMs, source: "raf" });
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame((timeMs) => finishWithRaf(timeMs));
      return;
    }
	    clearTimeout(timeoutId);
	    finishWithTimeout();
	  });
	  const enableAgentPanelProfile =
	    collectAgentPanelProfile && typeof window.__acepeEnableAgentPanelPerformanceCapture === "function"
	      ? window.__acepeEnableAgentPanelPerformanceCapture
	      : null;
	  const disableAgentPanelProfile =
	    collectAgentPanelProfile && typeof window.__acepeDisableAgentPanelPerformanceCapture === "function"
	      ? window.__acepeDisableAgentPanelPerformanceCapture
	      : null;
	  if (enableAgentPanelProfile !== null) {
	    enableAgentPanelProfile();
	    await waitForNextFrame();
	    await waitForNextFrame();
	  }
	
	  let selectorMatched = false;
	  let selectorMatchCount = 0;
	  let scrolled = false;
	  const getScrollTarget = () => {
	    const selectorMatches = selector.length > 0 ? Array.from(document.querySelectorAll(selector)) : [];
	    selectorMatchCount = selectorMatches.length;
	    const target = selectorMatches[selectorIndex] ?? null;
	    if (!(target instanceof HTMLElement)) {
	      return null;
	    }
	    selectorMatched = true;
	    return target;
	  };
	  const maxScrollTopFor = (target) =>
	    Math.max(0, target.scrollHeight - target.clientHeight);
	  const dispatchWheelIntent = (target, deltaY) => {
	    if (typeof WheelEvent === "function") {
	      target.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
	      return;
    }
    target.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true }));
	  };
	  const readMountedRows = () => {
	    const target = getScrollTarget();
	    if (target === null) {
	      return {
	        rows: [],
	        ids: [],
	        domRowCount: 0,
        firstRowIndex: null,
        lastRowIndex: null,
      };
    }
    const rowNodes = Array.from(target.querySelectorAll("[data-row-id][data-row-index]"));
    const rows = [];
    const ids = [];
    let firstRowIndex = null;
    let lastRowIndex = null;
    for (const node of rowNodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      const rowId = node.getAttribute("data-row-id");
      const rowIndexText = node.getAttribute("data-row-index");
      const rowIndex = rowIndexText === null ? Number.NaN : Number(rowIndexText);
      if (rowId === null || !Number.isFinite(rowIndex)) {
        continue;
      }
      const text = String(node.textContent || "").trim().replace(/\\s+/g, " ");
      const entryNode = node.querySelector("[data-entry-type]");
      const entryType = entryNode instanceof HTMLElement ? entryNode.getAttribute("data-entry-type") : null;
      const toolKind = entryNode instanceof HTMLElement ? entryNode.getAttribute("data-tool-kind") : null;
      const toolStatus = entryNode instanceof HTMLElement ? entryNode.getAttribute("data-tool-status") : null;
      const toolTitle = entryNode instanceof HTMLElement ? entryNode.getAttribute("data-tool-title") : null;
      const toolPresentationState =
        entryNode instanceof HTMLElement ? entryNode.getAttribute("data-tool-presentation-state") : null;
      const visualSignature = [
        entryType || "unknown",
        toolKind || "none",
        toolStatus || "none",
        toolPresentationState || "none",
        toolTitle || "none",
      ].join("/");
      rows.push({
        rowId,
        rowIndex,
        text: text.length > 120 ? text.slice(0, 120) : text,
        visualSignature,
      });
      ids.push(rowId);
      firstRowIndex = firstRowIndex === null ? rowIndex : Math.min(firstRowIndex, rowIndex);
      lastRowIndex = lastRowIndex === null ? rowIndex : Math.max(lastRowIndex, rowIndex);
    }
    return {
      rows,
      ids,
      domRowCount: ids.length,
      firstRowIndex,
      lastRowIndex,
    };
  };
	  const changedRows = (left, right) => {
    const rightIds = new Set(right.map((row) => row.rowId));
    return left.filter((row) => !rightIds.has(row.rowId));
	  };
	  const readAgentPanelProfileSamples = () => {
	    const reader = window.__acepeReadAgentPanelPerformanceCapture;
	    if (typeof reader !== "function") {
	      return [];
	    }
	    const samples = reader();
	    return Array.isArray(samples) ? samples : [];
	  };
	  const summarizeAgentPanelProfileSamples = (samples) => {
	    const summariesByPhase = new Map();
	    for (const sample of samples) {
	      if (
	        sample === null ||
	        typeof sample !== "object" ||
	        typeof sample.phase !== "string" ||
	        typeof sample.durationMs !== "number" ||
	        !Number.isFinite(sample.durationMs)
	      ) {
	        continue;
	      }
	      const existing = summariesByPhase.get(sample.phase) || {
	        phase: sample.phase,
	        count: 0,
	        totalDurationMs: 0,
	        averageDurationMs: 0,
	        maxDurationMs: 0,
	        maxItemCount: null,
	        maxNodeCount: null,
	      };
	      existing.count += 1;
	      existing.totalDurationMs += sample.durationMs;
	      existing.maxDurationMs = Math.max(existing.maxDurationMs, sample.durationMs);
	      if (typeof sample.itemCount === "number" && Number.isFinite(sample.itemCount)) {
	        existing.maxItemCount =
	          existing.maxItemCount === null
	            ? sample.itemCount
	            : Math.max(existing.maxItemCount, sample.itemCount);
	      }
	      if (typeof sample.nodeCount === "number" && Number.isFinite(sample.nodeCount)) {
	        existing.maxNodeCount =
	          existing.maxNodeCount === null
	            ? sample.nodeCount
	            : Math.max(existing.maxNodeCount, sample.nodeCount);
	      }
	      summariesByPhase.set(sample.phase, existing);
	    }
	    const summaries = [];
	    for (const summary of summariesByPhase.values()) {
	      summaries.push({
	        phase: summary.phase,
	        count: summary.count,
	        totalDurationMs: summary.totalDurationMs,
	        averageDurationMs: summary.count === 0 ? 0 : summary.totalDurationMs / summary.count,
	        maxDurationMs: summary.maxDurationMs,
	        maxItemCount: summary.maxItemCount,
	        maxNodeCount: summary.maxNodeCount,
	      });
	    }
	    summaries.sort((left, right) => right.totalDurationMs - left.totalDurationMs);
	    return summaries;
	  };
	  let previousFrame = await waitForNextFrame();
  let previousRows = collectRowChurn
    ? readMountedRows()
    : {
        rows: [],
        ids: [],
        domRowCount: 0,
        firstRowIndex: null,
        lastRowIndex: null,
      };
  if (collectRowChurn) {
    for (const row of previousRows.rows) {
      visualSignatureByRowId.set(row.rowId, row.visualSignature);
    }
  }
	  for (let index = 0; index < effectiveSampleCount; index += 1) {
	    const target = getScrollTarget();
	    if (target !== null) {
	      const maxScrollTop = maxScrollTopFor(target);
	      const canScroll = maxScrollTop > 0;
	      if (canScroll) {
	        scrolled = true;
	      const progress = effectiveSampleCount <= 1 ? 1 : index / (effectiveSampleCount - 1);
	      const beforeScrollTop = target.scrollTop;
	      const nextScrollTop =
	        scrollStepPx === null
	          ? maxScrollTop * progress
	          : Math.max(0, beforeScrollTop - scrollStepPx);
	      dispatchWheelIntent(target, nextScrollTop - beforeScrollTop);
	      target.scrollTop =
	        nextScrollTop;
	      target.dispatchEvent(new Event("scroll"));
	      }
	    }
    const currentFrame = await waitForNextFrame();
    const currentRows = collectRowChurn
      ? readMountedRows()
      : {
          rows: [],
          ids: [],
          domRowCount: 0,
          firstRowIndex: null,
          lastRowIndex: null,
        };
    frameDeltasMs.push(currentFrame.timeMs - previousFrame.timeMs);
    if (collectRowChurn) {
      for (const row of currentRows.rows) {
        const previousSignature = visualSignatureByRowId.get(row.rowId);
        if (
          typeof previousSignature === "string" &&
          previousSignature !== row.visualSignature
        ) {
          visualChangeCount += 1;
          if (visualChanges.length < 24) {
            visualChanges.push({
              frameIndex: index,
              rowId: row.rowId,
              rowIndex: row.rowIndex,
              previousSignature,
              nextSignature: row.visualSignature,
              text: row.text,
            });
          }
        }
        visualSignatureByRowId.set(row.rowId, row.visualSignature);
      }
      const mountedRows = changedRows(currentRows.rows, previousRows.rows);
      const unmountedRows = changedRows(previousRows.rows, currentRows.rows);
      rowChurnSamples.push({
	        frameIndex: index,
	        scrollTopPx: getScrollTarget()?.scrollTop ?? 0,
        domRowCount: currentRows.domRowCount,
        firstRowIndex: currentRows.firstRowIndex,
        lastRowIndex: currentRows.lastRowIndex,
        mountedRowCount: mountedRows.length,
        unmountedRowCount: unmountedRows.length,
        mountedRows: mountedRows.slice(0, 12),
        unmountedRows: unmountedRows.slice(0, 12),
      });
    }
    previousFrame = currentFrame;
    previousRows = currentRows;
  }

  let totalFrameDeltaMs = 0;
  let minFrameDeltaMs = null;
  let maxFrameDeltaMs = null;
  let jankFrameCount = 0;
  let maxMountedRowCount = null;
  let maxUnmountedRowCount = null;
  let maxDomRowCount = null;
  for (const deltaMs of frameDeltasMs) {
    totalFrameDeltaMs += deltaMs;
    minFrameDeltaMs = minFrameDeltaMs === null ? deltaMs : Math.min(minFrameDeltaMs, deltaMs);
    maxFrameDeltaMs = maxFrameDeltaMs === null ? deltaMs : Math.max(maxFrameDeltaMs, deltaMs);
    if (deltaMs > 20) {
      jankFrameCount += 1;
    }
  }
	  for (const sample of rowChurnSamples) {
    maxMountedRowCount =
      maxMountedRowCount === null ? sample.mountedRowCount : Math.max(maxMountedRowCount, sample.mountedRowCount);
    maxUnmountedRowCount =
      maxUnmountedRowCount === null ? sample.unmountedRowCount : Math.max(maxUnmountedRowCount, sample.unmountedRowCount);
    maxDomRowCount =
      maxDomRowCount === null ? sample.domRowCount : Math.max(maxDomRowCount, sample.domRowCount);
  }
  const averageFrameDeltaMs =
    frameDeltasMs.length === 0 ? null : totalFrameDeltaMs / frameDeltasMs.length;
  const estimatedFps =
    averageFrameDeltaMs === null || averageFrameDeltaMs <= 0 ? null : 1000 / averageFrameDeltaMs;
  const visibilityState =
    typeof document !== "undefined" ? document.visibilityState : null;
  const documentHasFocus =
    typeof document !== "undefined" && typeof document.hasFocus === "function"
      ? document.hasFocus()
      : null;
  const requestAnimationFrameAvailable = typeof requestAnimationFrame === "function";
	  const likelyThrottled = visibilityState !== "visible" || timeoutWaitCount > 0;
	  const agentPanelProfileSamples = collectAgentPanelProfile ? readAgentPanelProfileSamples() : [];
	  if (disableAgentPanelProfile !== null) {
	    disableAgentPanelProfile();
	  }
	  const agentPanelProfilePhaseSummaries =
	    summarizeAgentPanelProfileSamples(agentPanelProfileSamples);

	  return {
    route: typeof window !== "undefined" ? window.location.pathname : null,
    selector: selector.length > 0 ? selector : null,
    selectorIndex,
    selectorMatchCount,
    selectorMatched,
    scrolled,
    sampleCount: frameDeltasMs.length,
    frameDeltasMs,
    averageFrameDeltaMs,
    minFrameDeltaMs,
    maxFrameDeltaMs,
    estimatedFps,
    jankFrameCount,
    visibilityState,
    documentHasFocus,
    requestAnimationFrameAvailable,
    rafWaitCount,
    timeoutWaitCount,
    likelyThrottled,
	    rowChurnSamples,
	    visualChangeCount,
	    visualChanges,
	    maxMountedRowCount,
	    maxUnmountedRowCount,
	    maxDomRowCount,
	    agentPanelProfileSamples,
	    agentPanelProfilePhaseSummaries,
	  };
	})()
	`;
}

export function probeFrameRate(
	options: DriverOptions & {
		readonly sampleCount: number;
		readonly selector: string;
		readonly selectorIndex?: number;
		readonly collectRowChurn?: boolean;
		readonly collectAgentPanelProfile?: boolean;
		readonly scrollStepPx?: number | null;
	}
): ResultAsync<FrameRateProbeResult, TauriMcpFailure> {
	const callTimeoutMs = Math.max(8_000, options.sampleCount * 80);
	return driverReady(options).andThen(() =>
		executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script: frameRateProbeScript({
					sampleCount: Math.max(1, Math.floor(options.sampleCount)),
					selector: options.selector,
					selectorIndex: options.selectorIndex ?? 0,
					collectRowChurn: options.collectRowChurn === true,
					collectAgentPanelProfile: options.collectAgentPanelProfile === true,
					scrollStepPx:
						options.scrollStepPx !== undefined &&
						options.scrollStepPx !== null &&
						Number.isFinite(options.scrollStepPx) &&
						options.scrollStepPx > 0
							? options.scrollStepPx
							: null,
				}),
				schema: frameRateProbeResultSchema,
				callTimeoutMs,
			},
			options.runner
		)
	);
}

export function scanAgentPanelRows(
	options: DriverOptions & {
		readonly selector: string;
		readonly selectorIndex: number;
		readonly limit: number;
	}
): ResultAsync<AgentPanelRowScanResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(() => {
  const selector = ${escapedJson(options.selector)};
  const selectorIndex = ${Math.max(0, Math.floor(options.selectorIndex)).toString()};
  const limit = ${Math.max(1, Math.floor(options.limit)).toString()};
  const selectorMatches = Array.from(document.querySelectorAll(selector));
  const target = selectorMatches[selectorIndex] ?? null;
  const selectorMatched = target instanceof HTMLElement;
	  const rows = [];
	  const genericToolRows = [];
	  const rawProviderToolRows = [];
	  const missingEntryRows = [];
	  const degradedToolRows = [];
	  let firstRowIndex = null;
	  let lastRowIndex = null;
	  let emptyRowCount = 0;
	  let exactGenericToolRowCount = 0;
	  let prefixGenericToolRowCount = 0;
	  let rawProviderToolRowCount = 0;
	  let missingEntryRowCount = 0;
	  let degradedToolRowCount = 0;
	  const normalizeText = (value) => String(value || "").trim().replace(/\\s+/g, " ");
	  const normalizeToolLeakText = (value) =>
	    normalizeText(value).toLowerCase().replace(/[.\\s-]+/g, "_").replace(/_+/g, "_");
	  const rawProviderToolNames = [
	    "exec_command",
	    "functions_exec_command",
	    "run_command",
	    "run_terminal_cmd",
	    "shell_command",
	    "write_stdin",
	  ];
	  const hasRawProviderToolLabel = (value) => {
	    const text = normalizeToolLeakText(value);
	    return rawProviderToolNames.some(
	      (name) =>
	        text === name ||
	        text.startsWith(name + "_") ||
	        text === "tool_" + name ||
	        text.startsWith("tool_" + name + "_")
	    );
	  };
	  const rowNodes = selectorMatched ? Array.from(target.querySelectorAll("[data-row-id]")) : [];
  const summarizeRow = (node, index) => {
    const rowIndexText = node.getAttribute("data-row-index");
    const rowIndex = rowIndexText === null ? null : Number(rowIndexText);
    const normalizedRowIndex = Number.isFinite(rowIndex) ? rowIndex : null;
    const text = normalizeText(node.textContent);
    const rect = node.getBoundingClientRect();
    const entryNode = node.querySelector("[data-entry-type]");
    const entryType = entryNode instanceof HTMLElement ? entryNode.getAttribute("data-entry-type") : null;
    const toolKind = entryNode instanceof HTMLElement ? entryNode.getAttribute("data-tool-kind") : null;
    const toolStatus = entryNode instanceof HTMLElement ? entryNode.getAttribute("data-tool-status") : null;
    const toolTitle = entryNode instanceof HTMLElement ? entryNode.getAttribute("data-tool-title") : null;
    const toolPresentationState =
      entryNode instanceof HTMLElement ? entryNode.getAttribute("data-tool-presentation-state") : null;
    const missingEntry =
      entryNode instanceof HTMLElement && entryNode.hasAttribute("data-missing-entry");
    return {
      index,
      rowId: node.getAttribute("data-row-id"),
      rowIndex: normalizedRowIndex,
      text,
      heightPx: rect.height,
      entryType,
      toolKind,
      toolStatus,
      toolTitle,
      toolPresentationState,
      missingEntry,
    };
  };
  rowNodes.forEach((node, index) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const row = summarizeRow(node, index);
    if (row.rowIndex !== null) {
      firstRowIndex = firstRowIndex === null ? row.rowIndex : Math.min(firstRowIndex, row.rowIndex);
      lastRowIndex = lastRowIndex === null ? row.rowIndex : Math.max(lastRowIndex, row.rowIndex);
    }
    if (row.text.length === 0) {
      emptyRowCount += 1;
    }
    const exactGeneric = row.text === "Tool";
    const prefixGeneric = exactGeneric || row.text.startsWith("Tool ");
    if (exactGeneric) {
      exactGenericToolRowCount += 1;
    }
	    if (prefixGeneric) {
	      prefixGenericToolRowCount += 1;
	    }
	    const rawProviderToolLabel = hasRawProviderToolLabel(row.text);
	    if (rawProviderToolLabel) {
	      rawProviderToolRowCount += 1;
	    }
	    if (row.missingEntry) {
	      missingEntryRowCount += 1;
	    }
	    if (row.toolPresentationState === "degraded_operation") {
	      degradedToolRowCount += 1;
	    }
	    if (rows.length < limit) {
	      rows.push(row);
	    }
	    if (prefixGeneric && genericToolRows.length < limit) {
	      genericToolRows.push(row);
	    }
	    if (rawProviderToolLabel && rawProviderToolRows.length < limit) {
	      rawProviderToolRows.push(row);
	    }
	    if (row.missingEntry && missingEntryRows.length < limit) {
	      missingEntryRows.push(row);
	    }
	    if (row.toolPresentationState === "degraded_operation" && degradedToolRows.length < limit) {
	      degradedToolRows.push(row);
	    }
	  });
  return {
    route: typeof window !== "undefined" ? window.location.pathname : null,
    selector,
    selectorIndex,
    selectorMatchCount: selectorMatches.length,
    selectorMatched,
    scrollTopPx: selectorMatched ? target.scrollTop : null,
    scrollHeightPx: selectorMatched ? target.scrollHeight : null,
    clientHeightPx: selectorMatched ? target.clientHeight : null,
    maxScrollTopPx: selectorMatched ? Math.max(0, target.scrollHeight - target.clientHeight) : null,
    rowCount: rowNodes.length,
    emptyRowCount,
	    exactGenericToolRowCount,
	    prefixGenericToolRowCount,
	    rawProviderToolRowCount,
	    missingEntryRowCount,
	    degradedToolRowCount,
	    firstRowIndex,
	    lastRowIndex,
	    rows,
	    genericToolRows,
	    rawProviderToolRows,
	    missingEntryRows,
	    degradedToolRows,
	  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: agentPanelRowScanResultSchema,
			},
			runner
		);
	});
}

export function probeAgentPanelScrollPages(
	options: DriverOptions & {
		readonly selector: string;
		readonly selectorIndex: number;
		readonly sampleCount: number;
		readonly scrollStepPx: number | null;
		readonly settleMs: number;
	}
): ResultAsync<AgentPanelScrollPageProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const sampleCount = Math.max(1, Math.floor(options.sampleCount));
		const settleMs = Math.max(0, Math.floor(options.settleMs));
		const scrollStepPx =
			options.scrollStepPx !== null &&
			Number.isFinite(options.scrollStepPx) &&
			options.scrollStepPx > 0
				? options.scrollStepPx
				: null;
		const script = `
(async () => {
  const selector = ${escapedJson(options.selector)};
  const selectorIndex = ${Math.max(0, Math.floor(options.selectorIndex)).toString()};
  const requestedSampleCount = ${sampleCount.toString()};
  const requestedSettleMs = ${settleMs.toString()};
	  const requestedScrollStepPx = ${scrollStepPx === null ? "null" : scrollStepPx.toString()};
	  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	  const normalizeText = (value) => String(value || "").trim().replace(/\\s+/g, " ");
	  const normalizeToolLeakText = (value) =>
	    normalizeText(value).toLowerCase().replace(/[.\\s-]+/g, "_").replace(/_+/g, "_");
	  const rawProviderToolNames = [
	    "exec_command",
	    "functions_exec_command",
	    "run_command",
	    "run_terminal_cmd",
	    "shell_command",
	    "write_stdin",
	  ];
	  const hasRawProviderToolLabel = (value) => {
	    const text = normalizeToolLeakText(value);
	    return rawProviderToolNames.some(
	      (name) =>
	        text === name ||
	        text.startsWith(name + "_") ||
	        text === "tool_" + name ||
	        text.startsWith("tool_" + name + "_")
	    );
	  };
	  const focusProbeWindow = async () => {
    const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
    const currentWindow =
      tauriWindow &&
      typeof tauriWindow.getCurrentWindow === "function" &&
      tauriWindow.getCurrentWindow();
    if (currentWindow && typeof currentWindow.show === "function") {
      await currentWindow.show().then(() => undefined, () => undefined);
    }
    if (typeof window.focus === "function") {
      window.focus();
    }
    if (currentWindow && typeof currentWindow.setFocus === "function") {
      await currentWindow.setFocus().then(() => undefined, () => undefined);
    }
    await sleep(150);
  };
  let rafWaitCount = 0;
  let timeoutWaitCount = 0;
  const waitForNextFrame = () => new Promise((resolve) => {
    let settled = false;
    const finishWithTimeout = () => {
      if (settled) {
        return;
      }
      settled = true;
      timeoutWaitCount += 1;
      resolve({ timeMs: performance.now(), source: "timeout" });
    };
    const timeoutId = setTimeout(() => finishWithTimeout(), 50);
    const finishWithRaf = (timeMs) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      rafWaitCount += 1;
      resolve({ timeMs, source: "raf" });
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame((timeMs) => finishWithRaf(timeMs));
      return;
    }
    clearTimeout(timeoutId);
    finishWithTimeout();
  });
  await focusProbeWindow();
  const selectorMatches = Array.from(document.querySelectorAll(selector));
  const target = selectorMatches[selectorIndex] ?? null;
  const selectorMatched = target instanceof HTMLElement;
  const samples = [];
  const timingSamples = [];
  const frameDeltasMs = [];
  const distinctRowIds = new Set();
  const distinctFirstRowIds = new Set();
  let maxSampleRowCount = 0;
  let zeroRowSampleCount = 0;
  let blankViewportSampleCount = 0;
  let maxEmptyRowCount = 0;
	  let maxExactGenericToolRowCount = 0;
	  let maxPrefixGenericToolRowCount = 0;
	  let maxRawProviderToolRowCount = 0;
  const numberAttr = (node, name) => {
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    const raw = node.getAttribute(name);
    if (raw === null || raw.trim().length === 0) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const textAttr = (node, name) => {
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    const raw = node.getAttribute(name);
    return raw === null || raw.trim().length === 0 ? null : raw;
  };
  const readBufferState = () => {
    if (!selectorMatched) {
      return {
        bufferStartIndex: null,
        bufferEndIndex: null,
        bufferRowCount: null,
        bufferTotalRowCount: null,
        bufferLastAction: null,
        bufferLastStatus: null,
        bufferLastReason: null,
      };
    }
    const host = target.closest('[data-testid="rust-transcript-viewport"]');
    return {
      bufferStartIndex: numberAttr(host, "data-buffer-start-index"),
      bufferEndIndex: numberAttr(host, "data-buffer-end-index"),
      bufferRowCount: numberAttr(host, "data-buffer-row-count"),
      bufferTotalRowCount: numberAttr(host, "data-buffer-total-row-count"),
      bufferLastAction: textAttr(host, "data-buffer-last-action"),
      bufferLastStatus: textAttr(host, "data-buffer-last-status"),
      bufferLastReason: textAttr(host, "data-buffer-last-reason"),
    };
  };
  const dispatchWheelIntent = (deltaY) => {
    if (!selectorMatched) {
      return;
    }
    if (typeof WheelEvent === "function") {
      target.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
      return;
    }
    target.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true }));
  };

  const sample = (stepIndex) => {
    if (!selectorMatched) {
      return {
        stepIndex,
        scrollTopPx: 0,
        scrollHeightPx: 0,
        clientHeightPx: 0,
        maxScrollTopPx: 0,
        bufferStartIndex: null,
        bufferEndIndex: null,
        bufferRowCount: null,
        bufferTotalRowCount: null,
        bufferLastAction: null,
        bufferLastStatus: null,
        bufferLastReason: null,
        rowCount: 0,
        emptyRowCount: 0,
	        exactGenericToolRowCount: 0,
	        prefixGenericToolRowCount: 0,
	        rawProviderToolRowCount: 0,
	        firstRowId: null,
        lastRowId: null,
        firstRowText: null,
        lastRowText: null,
      };
    }
    const bufferState = readBufferState();
    const rowNodes = Array.from(target.querySelectorAll("[data-row-id]"))
      .filter((node) => node instanceof HTMLElement);
    let emptyRowCount = 0;
	    let exactGenericToolRowCount = 0;
	    let prefixGenericToolRowCount = 0;
	    let rawProviderToolRowCount = 0;
    let firstRowId = null;
    let lastRowId = null;
    let firstRowText = null;
    let lastRowText = null;
    rowNodes.forEach((node, index) => {
      const rowId = node.getAttribute("data-row-id");
      const text = normalizeText(node.textContent);
      if (rowId !== null) {
        distinctRowIds.add(rowId);
      }
      if (index === 0) {
        firstRowId = rowId;
        firstRowText = text;
        if (rowId !== null) {
          distinctFirstRowIds.add(rowId);
        }
      }
      if (index === rowNodes.length - 1) {
        lastRowId = rowId;
        lastRowText = text;
      }
      if (text.length === 0) {
        emptyRowCount += 1;
      }
      const exactGeneric = text === "Tool";
      const prefixGeneric = exactGeneric || text.startsWith("Tool ");
      if (exactGeneric) {
        exactGenericToolRowCount += 1;
      }
	      if (prefixGeneric) {
	        prefixGenericToolRowCount += 1;
	      }
	      if (hasRawProviderToolLabel(text)) {
	        rawProviderToolRowCount += 1;
	      }
	    });
    const rowCount = rowNodes.length;
    const maxScrollTopPx = Math.max(0, target.scrollHeight - target.clientHeight);
    maxSampleRowCount = Math.max(maxSampleRowCount, rowCount);
    if (rowCount === 0) {
      zeroRowSampleCount += 1;
      if (maxScrollTopPx > 0) {
        blankViewportSampleCount += 1;
      }
    }
    maxEmptyRowCount = Math.max(maxEmptyRowCount, emptyRowCount);
	    maxExactGenericToolRowCount = Math.max(maxExactGenericToolRowCount, exactGenericToolRowCount);
	    maxPrefixGenericToolRowCount = Math.max(maxPrefixGenericToolRowCount, prefixGenericToolRowCount);
	    maxRawProviderToolRowCount = Math.max(maxRawProviderToolRowCount, rawProviderToolRowCount);
	    return {
      stepIndex,
      scrollTopPx: target.scrollTop,
      scrollHeightPx: target.scrollHeight,
      clientHeightPx: target.clientHeight,
      maxScrollTopPx,
      bufferStartIndex: bufferState.bufferStartIndex,
      bufferEndIndex: bufferState.bufferEndIndex,
      bufferRowCount: bufferState.bufferRowCount,
      bufferTotalRowCount: bufferState.bufferTotalRowCount,
      bufferLastAction: bufferState.bufferLastAction,
      bufferLastStatus: bufferState.bufferLastStatus,
      bufferLastReason: bufferState.bufferLastReason,
      rowCount,
      emptyRowCount,
	      exactGenericToolRowCount,
	      prefixGenericToolRowCount,
	      rawProviderToolRowCount,
	      firstRowId,
      lastRowId,
      firstRowText,
      lastRowText,
    };
  };

  let initialScrollTopPx = null;
  let initialScrollHeightPx = null;
  let clientHeightPx = null;
  let maxScrollTopPx = null;
  if (selectorMatched) {
    target.scrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    target.dispatchEvent(new Event("scroll"));
    await sleep(requestedSettleMs);
    initialScrollTopPx = target.scrollTop;
    initialScrollHeightPx = target.scrollHeight;
    clientHeightPx = target.clientHeight;
    maxScrollTopPx = Math.max(0, target.scrollHeight - target.clientHeight);
  }

  const effectiveStepPx =
    selectorMatched
      ? requestedScrollStepPx ?? Math.max(120, Math.floor(target.clientHeight * 0.85))
      : requestedScrollStepPx ?? 0;

  for (let stepIndex = 0; stepIndex < requestedSampleCount; stepIndex += 1) {
    samples.push(sample(stepIndex));
    if (!selectorMatched) {
      break;
    }
    if (target.scrollTop <= 0) {
      break;
    }
    const beforeScrollTopPx = target.scrollTop;
    const beforeScrollHeightPx = target.scrollHeight;
    const nextScrollTop = Math.max(0, target.scrollTop - effectiveStepPx);
    const previousFrame = await waitForNextFrame();
    const scrollStartedAtMs = performance.now();
    dispatchWheelIntent(nextScrollTop - beforeScrollTopPx);
    target.scrollTop = nextScrollTop;
    target.dispatchEvent(new Event("scroll"));
    const currentFrame = await waitForNextFrame();
    const frameDeltaMs = currentFrame.timeMs - previousFrame.timeMs;
    const scrollToFrameMs = Math.max(0, currentFrame.timeMs - scrollStartedAtMs);
    frameDeltasMs.push(frameDeltaMs);
    await sleep(requestedSettleMs);
    const afterSample = sample(stepIndex);
    const scrollHeightDeltaPx = target.scrollHeight - beforeScrollHeightPx;
    const scrollTopCorrectionPx = target.scrollTop - nextScrollTop;
    timingSamples.push({
      stepIndex,
      frameDeltaMs,
      scrollToFrameMs,
      beforeScrollTopPx,
      targetScrollTopPx: nextScrollTop,
      afterScrollTopPx: target.scrollTop,
      beforeScrollHeightPx,
      afterScrollHeightPx: target.scrollHeight,
      scrollHeightDeltaPx,
      scrollTopCorrectionPx,
      bufferStartIndex: afterSample.bufferStartIndex,
      bufferEndIndex: afterSample.bufferEndIndex,
      bufferRowCount: afterSample.bufferRowCount,
      bufferTotalRowCount: afterSample.bufferTotalRowCount,
      bufferLastAction: afterSample.bufferLastAction,
      bufferLastStatus: afterSample.bufferLastStatus,
      bufferLastReason: afterSample.bufferLastReason,
      rowCount: afterSample.rowCount,
      firstRowId: afterSample.firstRowId,
      lastRowId: afterSample.lastRowId,
    });
  }

  const finalScrollTopPx = selectorMatched ? target.scrollTop : null;
  const finalScrollHeightPx = selectorMatched ? target.scrollHeight : null;
  const reachedTop = selectorMatched && finalScrollTopPx !== null && finalScrollTopPx <= 1;
  const moved =
    selectorMatched &&
    initialScrollTopPx !== null &&
    finalScrollTopPx !== null &&
    Math.abs(initialScrollTopPx - finalScrollTopPx) > 1;
  const loadedMoreRows = distinctRowIds.size > maxSampleRowCount || distinctFirstRowIds.size > 1;
  let totalFrameDeltaMs = 0;
  let minFrameDeltaMs = null;
  let maxFrameDeltaMs = null;
  let missed120FrameCount = 0;
  let missed60FrameCount = 0;
  for (const deltaMs of frameDeltasMs) {
    totalFrameDeltaMs += deltaMs;
    minFrameDeltaMs = minFrameDeltaMs === null ? deltaMs : Math.min(minFrameDeltaMs, deltaMs);
    maxFrameDeltaMs = maxFrameDeltaMs === null ? deltaMs : Math.max(maxFrameDeltaMs, deltaMs);
    if (deltaMs > 8.5) {
      missed120FrameCount += 1;
    }
    if (deltaMs > 16.7) {
      missed60FrameCount += 1;
    }
  }
  let maxScrollHeightDeltaPx = 0;
  let maxScrollTopCorrectionPx = 0;
  for (const timingSample of timingSamples) {
    maxScrollHeightDeltaPx = Math.max(maxScrollHeightDeltaPx, Math.abs(timingSample.scrollHeightDeltaPx));
    maxScrollTopCorrectionPx = Math.max(maxScrollTopCorrectionPx, Math.abs(timingSample.scrollTopCorrectionPx));
  }
  const averageFrameDeltaMs =
    frameDeltasMs.length === 0 ? null : totalFrameDeltaMs / frameDeltasMs.length;
  const estimatedFps =
    averageFrameDeltaMs === null || averageFrameDeltaMs <= 0 ? null : 1000 / averageFrameDeltaMs;
  const visibilityState =
    typeof document !== "undefined" ? document.visibilityState : null;
  const documentHasFocus =
    typeof document !== "undefined" && typeof document.hasFocus === "function"
      ? document.hasFocus()
      : null;
  const likelyThrottled = visibilityState !== "visible" || timeoutWaitCount > 0;

  return {
    route: typeof window !== "undefined" ? window.location.pathname : null,
    selector,
    selectorIndex,
    selectorMatchCount: selectorMatches.length,
    selectorMatched,
    scrollStepPx: effectiveStepPx,
    settleMs: requestedSettleMs,
    sampleCount: samples.length,
    initialScrollTopPx,
    finalScrollTopPx,
    initialScrollHeightPx,
    finalScrollHeightPx,
    clientHeightPx,
    maxScrollTopPx,
    reachedTop,
    moved,
    loadedMoreRows,
    distinctRowIdCount: distinctRowIds.size,
    distinctFirstRowIdCount: distinctFirstRowIds.size,
    maxSampleRowCount,
    zeroRowSampleCount,
    blankViewportSampleCount,
    maxEmptyRowCount,
	    maxExactGenericToolRowCount,
	    maxPrefixGenericToolRowCount,
	    maxRawProviderToolRowCount,
    frameDeltasMs,
    averageFrameDeltaMs,
    minFrameDeltaMs,
    maxFrameDeltaMs,
    estimatedFps,
    missed120FrameCount,
    missed60FrameCount,
    visibilityState,
    documentHasFocus,
    rafWaitCount,
    timeoutWaitCount,
    likelyThrottled,
    maxScrollHeightDeltaPx,
    maxScrollTopCorrectionPx,
    timingSamples,
    samples,
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: agentPanelScrollPageProbeResultSchema,
				callTimeoutMs: Math.max(20_000, sampleCount * (settleMs + 600)),
			},
			runner
		);
	});
}

const ELEMENT_SUMMARY_HELPERS = `
const qaText = (node) => node ? (node.textContent || "").trim().replace(/\\s+/g, " ") : "";
const qaRect = (node) => {
  const rect = node.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
};
const qaSummary = (node, index) => ({
  index,
  tag: node.tagName.toLowerCase(),
  role: node.getAttribute("role"),
  name: node.getAttribute("aria-label") || qaText(node).slice(0, 90),
  text: qaText(node).slice(0, 300),
  value: "value" in node ? String(node.value) : null,
  src: node instanceof HTMLImageElement ? node.getAttribute("src") : null,
  attributes: Array.from(node.attributes)
    .filter((attribute) => attribute.name !== "class" && attribute.name !== "style")
    .reduce((attributes, attribute) => {
      attributes[attribute.name] = attribute.value;
      return attributes;
    }, {}),
  classes: typeof node.className === "string" ? node.className : "",
  visible: getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden",
  focused: document.activeElement === node,
  computedStyle: {
    display: getComputedStyle(node).display,
    opacity: getComputedStyle(node).opacity,
    color: getComputedStyle(node).color,
    backgroundColor: getComputedStyle(node).backgroundColor,
    gap: getComputedStyle(node).gap,
    rowGap: getComputedStyle(node).rowGap,
    columnGap: getComputedStyle(node).columnGap,
    paddingTop: getComputedStyle(node).paddingTop,
    paddingRight: getComputedStyle(node).paddingRight,
    paddingBottom: getComputedStyle(node).paddingBottom,
    paddingLeft: getComputedStyle(node).paddingLeft,
    animationName: getComputedStyle(node).animationName,
    animationDuration: getComputedStyle(node).animationDuration,
    animationDelay: getComputedStyle(node).animationDelay,
    animationIterationCount: getComputedStyle(node).animationIterationCount,
  },
  rect: qaRect(node),
  animationNames: Array.from(node.querySelectorAll("*"))
    .map((child) => getComputedStyle(child).animationName)
    .filter((name) => name !== "none")
    .slice(0, 12),
});
`;

export function inspectDom(
	options: DriverOptions & {
		readonly selector: string;
		readonly limit: number;
	}
): ResultAsync<DomInspectionResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(() => {
  ${ELEMENT_SUMMARY_HELPERS}
  const selector = ${escapedJson(options.selector)};
  const nodes = Array.from(document.querySelectorAll(selector)).slice(0, ${options.limit.toString()});
  return {
    selector,
    count: document.querySelectorAll(selector).length,
    elements: nodes.map((node, index) => qaSummary(node, index)),
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: domInspectionResultSchema,
			},
			runner
		);
	});
}

export function inspectShadowDom(
	options: DriverOptions & {
		readonly hostSelector: string;
		readonly selector: string;
		readonly limit: number;
	}
): ResultAsync<DomInspectionResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(() => {
  ${ELEMENT_SUMMARY_HELPERS}
  const hostSelector = ${escapedJson(options.hostSelector)};
  const selector = ${escapedJson(options.selector)};
  const hosts = Array.from(document.querySelectorAll(hostSelector));
  const nodes = [];
  let count = 0;
  for (const host of hosts) {
    const root = host.shadowRoot;
    if (root === null) {
      continue;
    }
    const matches = Array.from(root.querySelectorAll(selector));
    count += matches.length;
    for (const node of matches) {
      if (nodes.length < ${options.limit.toString()}) {
        nodes.push(node);
      }
    }
  }
  return {
    selector: hostSelector + " >>> " + selector,
    count,
    elements: nodes.map((node, index) => qaSummary(node, index)),
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: domInspectionResultSchema,
			},
			runner
		);
	});
}

export function readPlanningDebug(
	options: DriverOptions & {
		readonly sessionId: string | null;
	}
): ResultAsync<PlanningDebugResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(() => {
  const fn = window.__acepePlanningSnapshot;
  if (typeof fn !== "function") {
    return { available: false, snapshots: [] };
  }
  const sessionId = ${escapedJson(options.sessionId ?? "")};
  const snapshots = fn(sessionId.length > 0 ? sessionId : null);
  return { available: true, snapshots: Array.isArray(snapshots) ? snapshots : [] };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: planningDebugResultSchema,
			},
			runner
		);
	});
}

export function probeHappyPathPerformance(
	options: DriverOptions & {
		readonly timeoutMs?: number;
	}
): ResultAsync<HappyPathPerformanceResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	const timeoutMs = options.timeoutMs ?? 20_000;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const timeoutMs = ${timeoutMs.toString()};
  const waitForFrame = () => new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    setTimeout(finish, 50);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish);
      return;
    }
    finish();
  });
  const ensureMainRoute = async () => {
    if (window.location.pathname === "/") {
      return;
    }
    const targetUrl = new URL("/", window.location.origin);
    const anchor = document.createElement("a");
    anchor.href = targetUrl.href;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    anchor.remove();
    const startedAtMs = performance.now();
    while (window.location.pathname !== "/" && performance.now() - startedAtMs < timeoutMs) {
      await waitForFrame();
    }
  };
  const waitForHook = async () => {
    const startedAtMs = performance.now();
    while (performance.now() - startedAtMs < timeoutMs) {
      const hook = window.__acepeHappyPathProbe;
      if (typeof hook === "function") {
        return hook;
      }
      await waitForFrame();
    }
    return null;
  };
  await ensureMainRoute();
  const readRuntimeErrors = () => {
    const records = Array.isArray(window.__acepeRuntimeErrors) ? window.__acepeRuntimeErrors : [];
    return records.map((record) => record && typeof record.message === "string" ? record.message : "Unknown runtime error").slice(-10);
  };
  const unavailable = {
    hookAvailable: false,
    route: window.location.pathname,
    runtimeErrors: readRuntimeErrors(),
    timingEnvironment: {
      visibilityState: typeof document.visibilityState === "string" ? document.visibilityState : "unknown",
      documentHasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
      requestAnimationFrameAvailable: typeof requestAnimationFrame === "function",
      frameWaitCount: 0,
      frameFallbackCount: 0,
      likelyThrottled: true,
      label: "unavailable",
    },
    navigation: {
      type: null,
      startTimeMs: null,
      domInteractiveMs: null,
      domContentLoadedMs: null,
      loadEventEndMs: null,
      durationMs: null,
    },
    app: {
      mountStartedAtMs: null,
      shellReadyAtMs: null,
      shellReadyDurationMs: null,
      shellReady: false,
      shellReadyWaitMs: null,
      initializationCompleteAtMs: null,
      initializationDurationMs: null,
      initializationComplete: false,
      initializationWaitMs: null,
      projectReady: false,
      projectReadyWaitMs: null,
      projectCountAtPanelCreate: 0,
      startupTrace: [],
      projectLoadTrace: null,
      tauriInvokeTimings: [],
      panelCountBefore: document.querySelectorAll("[data-testid='agent-panel-host']").length,
      panelCountAfter: document.querySelectorAll("[data-testid='agent-panel-host']").length,
      domPanelCountBefore: document.querySelectorAll("[data-testid='agent-panel-host']").length,
      domPanelCountAfter: document.querySelectorAll("[data-testid='agent-panel-host']").length,
    },
    openClose: {
      panelId: "",
      projectPath: null,
      panelOpenMarks: {},
      panelFirstMarkMs: null,
      panelLastMarkMs: null,
      panelMarkedWorkMs: null,
      panelPreMarkDelayMs: null,
      panelDomReadyAfterLastMarkMs: null,
      composerReadyAfterLastMarkMs: null,
      panelCreateMs: 0,
      panelDomPresentAfterCreate: false,
      panelDomMutationMs: null,
      panelDomAfterDomFlushMs: null,
      panelDomAfterFirstFrameMs: null,
      panelDomReadyMs: null,
      composerMutationMs: null,
      composerReadyMs: null,
      composerReadyAfterCreateMs: null,
      panelDomNodeCount: 0,
      panelRowNodeCount: 0,
      panelDropdownContentNodeCount: 0,
      resizeObserverConstructCount: null,
      resizeObserverObserveCount: null,
      resizeObserverCallbackCount: null,
      closeCallReturnMs: 0,
      closeMicrotaskMs: 0,
      closeDomGoneAfterMicrotask: false,
      closeFirstFrameMs: null,
      closeDomGoneAfterFirstFrame: false,
      closeDomGoneMs: null,
      closeTrace: null,
      totalMs: 0,
    },
  };
  const hook = await waitForHook();
  if (hook === null) {
    return unavailable;
  }
  return await hook({ timeoutMs });
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: happyPathPerformanceResultSchema,
				callTimeoutMs: timeoutMs + 2_000,
			},
			runner
		);
	});
}

export function probeSessionOpenContent(
	options: DriverOptions & {
		readonly sessionId: string;
		readonly projectPath: string;
		readonly agentId: string;
		readonly sourcePath: string | null;
		readonly title: string | null;
		readonly timeoutMs?: number;
		readonly closeAfter?: boolean;
	}
): ResultAsync<SessionOpenContentProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	const requestedTimeoutMs = options.timeoutMs ?? 5_000;
	const inPageTimeoutMs = Math.min(Math.max(1_000, requestedTimeoutMs), 60_000);
	const runId = `session-open-content-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	return driverReady(options).andThen(() =>
		startSessionOpenContentProbeRun({
			options,
			runner,
			runId,
			inPageTimeoutMs,
		}).andThen((status) => {
			if (status.status === "done" && status.result !== null) {
				return okAsync(status.result);
			}
			return pollSessionOpenContentProbeRun({
				options,
				runner,
				runId,
				deadlineMs: Date.now() + inPageTimeoutMs + 15_000,
			});
		})
	);
}

function sessionOpenContentUnavailableResultScript(sessionIdExpression: string): string {
	return `{
      hookAvailable: false,
      sessionId: ${sessionIdExpression},
      panelId: null,
      sessionKnownBeforeOpen: false,
      placeholderRegistered: false,
      closedExistingPanel: false,
      closeAfterRequested: true,
      selectCallMs: null,
      panelDomReadyMs: null,
      transcriptViewportReadyMs: null,
      firstRowDomReadyMs: null,
      firstRowPaintMs: null,
      rowCountAtFirstPaint: 0,
      finalRowCount: 0,
      panelStillOpenAtEnd: false,
      panelDomPresentAtEnd: false,
      sessionKnownAtEnd: false,
      sessionHasCanonicalProjectionAtEnd: false,
      sessionCanSendAtEnd: null,
      sessionLifecycleStatusAtEnd: null,
      sessionMessageCountAtEnd: null,
      timedOut: true,
      errorMessage: "window.__acepeSessionOpenContentProbe is unavailable.",
	      runtimeErrors: readRuntimeErrors(),
		      tauriInvokeTimings: [],
		      pendingTauriInvokes: [],
		      openEvents: [],
		      hydrationTimings: [],
		      panelOpenMarks: {},
		      agentPanelPerformanceSamples: [],
		    }`;
}

function startSessionOpenContentProbeRun(input: {
	readonly options: DriverOptions & {
		readonly sessionId: string;
		readonly projectPath: string;
		readonly agentId: string;
		readonly sourcePath: string | null;
		readonly title: string | null;
		readonly timeoutMs?: number;
		readonly closeAfter?: boolean;
	};
	readonly runner: CommandRunner;
	readonly runId: string;
	readonly inPageTimeoutMs: number;
}): ResultAsync<SessionOpenContentProbeRunStatus, TauriMcpFailure> {
	const script = `
(async () => {
  const runId = ${escapedJson(input.runId)};
  const timeoutMs = ${input.inPageTimeoutMs.toString()};
  const sessionId = ${escapedJson(input.options.sessionId)};
  const projectPath = ${escapedJson(input.options.projectPath)};
  const agentId = ${escapedJson(input.options.agentId)};
  const sourcePath = ${input.options.sourcePath === null ? "null" : escapedJson(input.options.sourcePath)};
  const title = ${input.options.title === null ? "null" : escapedJson(input.options.title)};
  const waitForFrame = () => new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    setTimeout(finish, 50);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish);
      return;
    }
    finish();
  });
  const ensureMainRoute = async () => {
    if (window.location.pathname === "/") {
      return;
    }
    const targetUrl = new URL("/", window.location.origin);
    const anchor = document.createElement("a");
    anchor.href = targetUrl.href;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    anchor.remove();
    const startedAtMs = performance.now();
    while (window.location.pathname !== "/" && performance.now() - startedAtMs < timeoutMs) {
      await waitForFrame();
    }
  };
  const waitForHook = async () => {
    const startedAtMs = performance.now();
    const hookTimeoutMs = Math.min(timeoutMs, 2_000);
    while (performance.now() - startedAtMs < hookTimeoutMs) {
      const hook = window.__acepeSessionOpenContentProbe;
      if (typeof hook === "function") {
        return hook;
      }
      await waitForFrame();
    }
    return null;
  };
  const readRuntimeErrors = () => {
    const records = Array.isArray(window.__acepeRuntimeErrors) ? window.__acepeRuntimeErrors : [];
    return records.map((record) => record && typeof record.message === "string" ? record.message : "Unknown runtime error").slice(-10);
  };
  await ensureMainRoute();
  window.__acepeSessionOpenContentProbeRuns = window.__acepeSessionOpenContentProbeRuns || {};
  const hook = await waitForHook();
  if (hook === null) {
    const result = ${sessionOpenContentUnavailableResultScript("sessionId")};
    window.__acepeSessionOpenContentProbeRuns[runId] = { runId, status: "done", result };
    return window.__acepeSessionOpenContentProbeRuns[runId];
  }
  window.__acepeSessionOpenContentProbeRuns[runId] = { runId, status: "running", result: null };
  hook({
    sessionId,
    projectPath,
    agentId,
    sourcePath,
    title,
    timeoutMs,
    closeExisting: true,
    closeAfter: ${input.options.closeAfter === false ? "false" : "true"},
  }).then((result) => {
    window.__acepeSessionOpenContentProbeRuns[runId] = { runId, status: "done", result };
  }, (error) => {
    window.__acepeSessionOpenContentProbeRuns[runId] = {
      runId,
      status: "done",
      result: {
        hookAvailable: true,
        sessionId,
        panelId: null,
        sessionKnownBeforeOpen: false,
        placeholderRegistered: false,
        closedExistingPanel: false,
        closeAfterRequested: ${input.options.closeAfter === false ? "false" : "true"},
        selectCallMs: null,
        panelDomReadyMs: null,
        transcriptViewportReadyMs: null,
        firstRowDomReadyMs: null,
        firstRowPaintMs: null,
        rowCountAtFirstPaint: 0,
        finalRowCount: 0,
        panelStillOpenAtEnd: false,
        panelDomPresentAtEnd: false,
        sessionKnownAtEnd: false,
        sessionHasCanonicalProjectionAtEnd: false,
        sessionCanSendAtEnd: null,
        sessionLifecycleStatusAtEnd: null,
        sessionMessageCountAtEnd: null,
        timedOut: true,
        errorMessage: error && typeof error.message === "string" ? error.message : String(error),
	        runtimeErrors: readRuntimeErrors(),
		        tauriInvokeTimings: [],
		        pendingTauriInvokes: [],
		        openEvents: [],
		        hydrationTimings: [],
		        panelOpenMarks: {},
		        agentPanelPerformanceSamples: [],
		      },
		    };
  });
  return window.__acepeSessionOpenContentProbeRuns[runId];
})()
`;
	return executeWebviewJson(
		{
			appIdentifier: input.options.appIdentifier,
			script,
			schema: sessionOpenContentProbeRunStatusSchema,
			callTimeoutMs: 5_000,
		},
		input.runner
	);
}

function readSessionOpenContentProbeRun(input: {
	readonly options: DriverOptions;
	readonly runner: CommandRunner;
	readonly runId: string;
}): ResultAsync<SessionOpenContentProbeRunStatus, TauriMcpFailure> {
	const script = `
(() => {
  const runId = ${escapedJson(input.runId)};
  const runs = window.__acepeSessionOpenContentProbeRuns || {};
  return runs[runId] || { runId, status: "missing", result: null };
})()
`;
	return executeWebviewJson(
		{
			appIdentifier: input.options.appIdentifier,
			script,
			schema: sessionOpenContentProbeRunStatusSchema,
			callTimeoutMs: 3_000,
		},
		input.runner
	);
}

function waitForProbePollDelay(): ResultAsync<null, TauriMcpFailure> {
	return ResultAsync.fromPromise(
		new Promise<null>((resolve) => {
			setTimeout(() => resolve(null), 250);
		}),
		(error) => ({
			code: "poll_delay_failed",
			message: error instanceof Error ? error.message : "Probe poll delay failed.",
		})
	);
}

function pollSessionOpenContentProbeRun(input: {
	readonly options: DriverOptions;
	readonly runner: CommandRunner;
	readonly runId: string;
	readonly deadlineMs: number;
}): ResultAsync<SessionOpenContentProbeResult, TauriMcpFailure> {
	return readSessionOpenContentProbeRun(input).andThen((status) => {
		if (status.status === "done" && status.result !== null) {
			return okAsync(status.result);
		}
		if (Date.now() >= input.deadlineMs) {
			return err({
				code: "session_open_content_probe_timeout",
				message: "Session open content probe did not finish before the QA polling deadline.",
			});
		}
		return waitForProbePollDelay().andThen(() => pollSessionOpenContentProbeRun(input));
	});
}

export function probeComputerUse(
	options: DriverOptions & {
		readonly sessionId: string;
		readonly action: string;
		readonly targetLabel: string;
		readonly text: string;
		readonly key: string;
		readonly dx: number | null;
		readonly dy: number | null;
	}
): ResultAsync<ComputerUseProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const sessionId = ${escapedJson(options.sessionId)};
  const action = ${options.action.length === 0 ? "null" : escapedJson(options.action)};
  const targetLabel = ${options.targetLabel.length === 0 ? "null" : escapedJson(options.targetLabel)};
  const text = ${options.text.length === 0 ? "null" : escapedJson(options.text)};
  const key = ${options.key.length === 0 ? "null" : escapedJson(options.key)};
  const dx = ${options.dx === null ? "null" : options.dx.toString()};
  const dy = ${options.dy === null ? "null" : options.dy.toString()};
  const tauriCore = window.__TAURI__ && window.__TAURI__.core;
  if (!tauriCore || typeof tauriCore.invoke !== "function") {
    return {
      serverName: "acepe_computer",
      toolName: "act",
      sessionId,
      transport: "tauri_command_to_in_process_mcp",
      ok: false,
      isError: true,
      payloadJson: "{}",
      app: null,
      window: null,
      elementCount: 0,
      errorCode: "tauri_invoke_unavailable",
      permissionKind: null,
      actionVerb: action,
      actionTargetLabel: targetLabel,
      actionTargetId: null,
      actionOk: false,
      actionErrorCode: "tauri_invoke_unavailable",
      actionChangedCount: null,
      actionElementCount: null,
    };
  }
  try {
    const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
    const currentWindow =
      tauriWindow &&
      typeof tauriWindow.getCurrentWindow === "function" &&
      tauriWindow.getCurrentWindow();
    if (currentWindow && typeof currentWindow.setFocus === "function") {
      await currentWindow.setFocus().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return await tauriCore.invoke("acp_probe_computer_use", {
      sessionId,
      action,
      targetLabel,
      text,
      key,
      dx,
      dy,
    });
  } catch (error) {
    const errorText =
      error && typeof error === "object"
        ? JSON.stringify(error)
        : String(error);
    return {
      serverName: "acepe_computer",
      toolName: "act",
      sessionId,
      transport: "tauri_command_to_in_process_mcp",
      ok: false,
      isError: true,
      payloadJson: JSON.stringify({ ok: false, error: errorText }),
      app: null,
      window: null,
      elementCount: 0,
      errorCode: "tauri_invoke_failed",
      permissionKind: null,
      actionVerb: action,
      actionTargetLabel: targetLabel,
      actionTargetId: null,
      actionOk: false,
      actionErrorCode: "tauri_invoke_failed",
      actionChangedCount: null,
      actionElementCount: null,
    };
  }
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: computerUseProbeResultSchema,
				callTimeoutMs: 20_000,
			},
			runner
		);
	});
}

export function probeLedgerBackfill(
	options: DriverOptions & {
		readonly limit: number;
	}
): ResultAsync<LedgerBackfillProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const tauriCore = window.__TAURI__ && window.__TAURI__.core;
  if (!tauriCore || typeof tauriCore.invoke !== "function") {
    return Promise.reject(new Error("tauri_invoke_unavailable"));
  }
  return await tauriCore.invoke("warm_recent_transcript_row_ledgers", {
    limit: ${Number.isFinite(options.limit) ? options.limit.toString() : "1"},
  });
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: ledgerBackfillProbeResultSchema,
				callTimeoutMs: 30_000,
			},
			runner
		);
	});
}

export function selectPanelProject(
	options: DriverOptions & {
		readonly panelId: string;
		readonly projectPath: string;
	}
): ResultAsync<PanelProjectSelectionResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const panelId = ${escapedJson(options.panelId)};
  const projectPath = ${escapedJson(options.projectPath)};
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const result = (fields) => ({
    panelId,
    projectPath,
    projectName: fields.projectName,
    projectFound: fields.projectFound,
    ambiguousName: fields.ambiguousName,
    triggerFound: fields.triggerFound,
    optionFound: fields.optionFound,
    selected: fields.selected,
    selectedAriaLabel: fields.selectedAriaLabel,
    errorMessage: fields.errorMessage,
  });
  const tauriCore = window.__TAURI__ && window.__TAURI__.core;
  if (!tauriCore || typeof tauriCore.invoke !== "function") {
    return result({
      projectName: null,
      projectFound: false,
      ambiguousName: false,
      triggerFound: false,
      optionFound: false,
      selected: false,
      selectedAriaLabel: null,
      errorMessage: "tauri_invoke_unavailable",
    });
  }
  const projects = await tauriCore.invoke("get_projects");
  const exactProjects = Array.isArray(projects)
    ? projects.filter((project) => project && project.path === projectPath && typeof project.name === "string")
    : [];
  if (exactProjects.length !== 1) {
    return result({
      projectName: null,
      projectFound: false,
      ambiguousName: false,
      triggerFound: false,
      optionFound: false,
      selected: false,
      selectedAriaLabel: null,
      errorMessage: exactProjects.length === 0 ? "project_path_not_found" : "duplicate_project_path",
    });
  }
  const projectName = exactProjects[0].name;
  const sameNameProjects = projects.filter((project) => project && project.name === projectName);
  const ambiguousName = sameNameProjects.some((project) => project.path !== projectPath);
  if (ambiguousName) {
    return result({
      projectName,
      projectFound: true,
      ambiguousName: true,
      triggerFound: false,
      optionFound: false,
      selected: false,
      selectedAriaLabel: null,
      errorMessage: "project_name_is_not_unique_in_picker",
    });
  }
  const panelRoot = Array.from(document.querySelectorAll("[data-qa-agent-panel-id]"))
    .find((candidate) => candidate.getAttribute("data-qa-agent-panel-id") === panelId) || null;
  if (panelRoot === null) {
    return result({
      projectName,
      projectFound: true,
      ambiguousName: false,
      triggerFound: false,
      optionFound: false,
      selected: false,
      selectedAriaLabel: null,
      errorMessage: "panel_not_found",
    });
  }
  const projectNames = new Set(projects.map((project) => project && project.name).filter((name) => typeof name === "string"));
  const triggerCandidates = Array.from(panelRoot.querySelectorAll("button[data-dropdown-menu-trigger]"))
    .filter((button) => projectNames.has(button.getAttribute("aria-label") || ""));
  if (triggerCandidates.length !== 1) {
    return result({
      projectName,
      projectFound: true,
      ambiguousName: false,
      triggerFound: false,
      optionFound: false,
      selected: false,
      selectedAriaLabel: null,
      errorMessage: triggerCandidates.length === 0 ? "project_trigger_not_found" : "project_trigger_is_ambiguous",
    });
  }
  const trigger = triggerCandidates[0];
  if (trigger.getAttribute("aria-label") === projectName) {
    return result({
      projectName,
      projectFound: true,
      ambiguousName: false,
      triggerFound: true,
      optionFound: true,
      selected: true,
      selectedAriaLabel: projectName,
      errorMessage: null,
    });
  }
  trigger.click();
  await wait(100);
  const normalizeText = (value) => (value || "").trim().replace(/\\s+/g, " ");
  const optionCandidates = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .filter((option) => {
      const text = normalizeText(option.textContent);
      return text === projectName || text.endsWith(" " + projectName);
    });
  if (optionCandidates.length !== 1) {
    trigger.click();
    return result({
      projectName,
      projectFound: true,
      ambiguousName: false,
      triggerFound: true,
      optionFound: false,
      selected: false,
      selectedAriaLabel: trigger.getAttribute("aria-label"),
      errorMessage: optionCandidates.length === 0 ? "project_option_not_found" : "project_option_is_ambiguous",
    });
  }
  optionCandidates[0].click();
  const selectionDeadline = performance.now() + 2_000;
  let selectedTrigger = null;
  while (performance.now() < selectionDeadline) {
    selectedTrigger = Array.from(panelRoot.querySelectorAll("button[data-dropdown-menu-trigger]"))
      .find((button) => button.getAttribute("aria-label") === projectName) || null;
    if (selectedTrigger !== null) break;
    await wait(50);
  }
  const selectedAriaLabel = selectedTrigger === null ? null : selectedTrigger.getAttribute("aria-label");
  return result({
    projectName,
    projectFound: true,
    ambiguousName: false,
    triggerFound: true,
    optionFound: true,
    selected: selectedAriaLabel === projectName,
    selectedAriaLabel,
    errorMessage: selectedAriaLabel === projectName ? null : "project_selection_not_reflected_in_panel",
  });
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: panelProjectSelectionResultSchema,
				callTimeoutMs: 10_000,
			},
			runner
		);
	});
}

export function clickWebview(
	options: DriverOptions & {
		readonly selector: string | null;
		readonly text: string | null;
		readonly thenSelector?: string | null;
		readonly thenText?: string | null;
		readonly key?: string | null;
	}
): ResultAsync<ClickResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  ${ELEMENT_SUMMARY_HELPERS}
  const selector = ${escapedJson(options.selector ?? "")};
  const text = ${escapedJson(options.text ?? "")};
  const thenSelector = ${escapedJson(options.thenSelector ?? "")};
  const thenText = ${escapedJson(options.thenText ?? "")};
  const key = ${escapedJson(options.key ?? "")};
	const thenRequested = thenSelector.length > 0 || thenText.length > 0;
	const dispatchWebviewClick = ${dispatchWebviewClick.toString()};
	const clickElement = (element, dispatchPointerEvents) =>
		dispatchWebviewClick(element, dispatchPointerEvents, sleep);
  const candidates = selector.length > 0
    ? Array.from(document.querySelectorAll(selector))
    : Array.from(document.querySelectorAll("button, [role=button], [role=menuitem], a, input, textarea, [contenteditable=true]"));
  const match = candidates.find((node) => {
    if (text.length === 0) return true;
    const label = node.getAttribute("aria-label") || "";
    return label.includes(text) || qaText(node).includes(text);
  }) || null;
  if (match) {
		await clickElement(match, !thenRequested);
    if (key.length > 0) {
      match.focus();
      await sleep(50);
      const keyInit = { bubbles: true, cancelable: true, key, code: key };
      match.dispatchEvent(new KeyboardEvent("keydown", keyInit));
      match.dispatchEvent(new KeyboardEvent("keyup", keyInit));
      await sleep(100);
    }
  }
	const findThenMatch = () => {
		if (!match || !thenRequested) return null;
		const thenCandidates = thenSelector.length > 0
			? Array.from(document.querySelectorAll(thenSelector))
			: Array.from(document.querySelectorAll("button, [role=button], [role=menuitem], a"));
		return thenCandidates.find((node) => {
			if (thenText.length === 0) return true;
			const label = node.getAttribute("aria-label") || "";
			return label.includes(thenText) || qaText(node).includes(thenText);
		}) || null;
	};
	let thenMatch = null;
	for (let attempt = 0; attempt < 10 && match && thenRequested && !thenMatch; attempt += 1) {
		await sleep(100);
		thenMatch = findThenMatch();
	}
	if (thenMatch) await clickElement(thenMatch, false);
  return {
		clicked: Boolean(match) && (!thenRequested || Boolean(thenMatch)),
		match: thenRequested
			? thenMatch ? qaSummary(thenMatch, 0) : null
			: match ? qaSummary(match, 0) : null,
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: clickResultSchema,
			},
			runner
		);
	});
}

export function hoverWebview(
	options: DriverOptions & {
		readonly selector: string | null;
		readonly afterSelector?: string | null;
		readonly afterLimit?: number;
		readonly text: string | null;
		readonly movePointer?: NativePointerMover;
		readonly delayMs?: number;
	}
): ResultAsync<HoverResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	const pointerMover = options.movePointer ?? moveNativePointer;
	const delayMs = Number.isFinite(options.delayMs)
		? Math.max(0, Math.floor(options.delayMs ?? 350))
		: 350;
	return driverReady(options).andThen(() => {
		const marker = `acepe-qa-hover-${Date.now().toString(36)}`;
		const locateScript = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const qaText = (node) => node ? (node.textContent || "").trim().replace(/\\s+/g, " ") : "";
  const selector = ${escapedJson(options.selector ?? "")};
  const text = ${escapedJson(options.text ?? "")};
  const marker = ${escapedJson(marker)};
  const markerAttribute = "data-acepe-qa-hover-target";
  for (const markedNode of document.querySelectorAll("[data-acepe-qa-hover-target]")) {
    markedNode.removeAttribute(markerAttribute);
  }
  const candidates = selector.length > 0
    ? Array.from(document.querySelectorAll(selector))
    : Array.from(document.querySelectorAll("button, [role=button], [role=menuitem], a, input, textarea, [contenteditable=true]"));
  const match = candidates.find((node) => {
    if (text.length === 0) return true;
    const label = node.getAttribute("aria-label") || "";
    return label.includes(text) || qaText(node).includes(text);
  }) || null;
  if (!match) {
    return { found: false, marker, screenPoint: null };
  }

  const tauriCore = window.__TAURI__ && window.__TAURI__.core;
  if (tauriCore && typeof tauriCore.invoke === "function") {
    await tauriCore.invoke("activate_window", { label: "main" }).then(
      () => undefined,
      () => undefined,
    );
  }
  const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
  const currentWindow = tauriWindow && typeof tauriWindow.getCurrentWindow === "function"
    ? tauriWindow.getCurrentWindow()
    : null;
  if (currentWindow && typeof currentWindow.show === "function") {
    await currentWindow.show().then(() => undefined, () => undefined);
  }
  if (typeof window.focus === "function") window.focus();
  if (currentWindow && typeof currentWindow.setFocus === "function") {
    await currentWindow.setFocus().then(() => undefined, () => undefined);
  }
  await sleep(250);

  match.setAttribute(markerAttribute, marker);
  match.scrollIntoView({ block: "center", inline: "nearest" });
  await sleep(150);
  const rect = match.getBoundingClientRect();
  const webviewScaleFactor = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  let screenScaleFactor = webviewScaleFactor;
  let contentOriginX = window.screenX + Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  let contentOriginY = window.screenY + Math.max(0, window.outerHeight - window.innerHeight);
  if (currentWindow && typeof currentWindow.scaleFactor === "function") {
    await currentWindow.scaleFactor().then((scaleFactor) => {
      if (Number.isFinite(scaleFactor) && scaleFactor > 0) screenScaleFactor = scaleFactor;
    }, () => undefined);
  }
  if (currentWindow && typeof currentWindow.innerPosition === "function") {
    await currentWindow.innerPosition().then((position) => {
      contentOriginX = position.x / screenScaleFactor;
      contentOriginY = position.y / screenScaleFactor;
    }, () => undefined);
  }
  const cssPixelsToScreenPoints = webviewScaleFactor / screenScaleFactor;
  return {
    found: true,
    marker,
    screenPoint: {
      x: contentOriginX + (rect.left + rect.width / 2) * cssPixelsToScreenPoints,
      y: contentOriginY + (rect.top + rect.height / 2) * cssPixelsToScreenPoints,
    },
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script: locateScript,
				schema: hoverTargetResultSchema,
			},
			runner
		).andThen((target) => {
			const move = target.screenPoint === null ? okAsync(null) : pointerMover(target.screenPoint);
			return move.andThen(() => {
				const sampleScript = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  ${ELEMENT_SUMMARY_HELPERS}
  const marker = ${escapedJson(target.marker)};
  const markerAttribute = "data-acepe-qa-hover-target";
  const afterSelector = ${escapedJson(options.afterSelector ?? "")};
  const afterLimit = ${Number.isFinite(options.afterLimit) ? String(options.afterLimit) : "10"};
  const markedNodes = Array.from(document.querySelectorAll("[data-acepe-qa-hover-target]"));
  const match = markedNodes.find((node) => node.getAttribute(markerAttribute) === marker) || null;
  if (match) match.removeAttribute(markerAttribute);
  await sleep(${delayMs.toString()});
  const matchesHoverPseudoClass = match ? match.matches(":hover") : false;
  const after = afterSelector.length === 0
    ? null
    : (() => {
      const afterCandidates = Array.from(document.querySelectorAll(afterSelector));
      return {
        selector: afterSelector,
        count: afterCandidates.length,
        elements: afterCandidates.slice(0, afterLimit).map((node, index) => qaSummary(node, index)),
      };
    })();
  return {
    hovered: matchesHoverPseudoClass,
    matchesHoverPseudoClass,
    pointerMoved: ${target.screenPoint === null ? "false" : "true"},
    screenPoint: ${JSON.stringify(target.screenPoint)},
    match: match ? qaSummary(match, 0) : null,
    after,
  };
})()
`;
				return executeWebviewJson(
					{
						appIdentifier: options.appIdentifier,
						script: sampleScript,
						schema: hoverResultSchema,
					},
					runner
				);
			});
		});
	});
}

export function navigateWebview(
	options: DriverOptions & {
		readonly path: string;
	}
): ResultAsync<NavigateResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const path = ${escapedJson(options.path)};
  const from = window.location.href;
  const url = new URL(path, window.location.origin);
  const anchor = document.createElement("a");
  anchor.href = url.href;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  anchor.remove();
  for (let i = 0; i < 20 && window.location.href !== url.href; i += 1) {
    await sleep(50);
  }
  await sleep(150);
  window.scrollTo(0, 0);
  if (document.scrollingElement) {
    document.scrollingElement.scrollTop = 0;
    document.scrollingElement.scrollLeft = 0;
  }
  return {
    from,
    to: window.location.href,
    path: url.pathname + url.search + url.hash,
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: navigateResultSchema,
			},
			runner
		);
	});
}

export function reloadWebview(
	options: DriverOptions
): ResultAsync<NavigateResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const marker = `acepe-qa-reload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		const markerKey = "__acepeQaReloadMarker";
		const script = `
(() => {
  const from = window.location.href;
  const path = window.location.pathname + window.location.search + window.location.hash;
  sessionStorage.setItem(${escapedJson(markerKey)}, ${escapedJson(marker)});
  window.__acepeQaReloadPendingMarker = ${escapedJson(marker)};
  setTimeout(() => window.location.reload(), 0);
  return {
    from,
    to: from,
    path,
  };
})()
`;
		return executeWebviewJsonSync(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: navigateResultSchema,
			},
			runner
		).andThen((kickoff) =>
			pollReloadReadiness({
				appIdentifier: options.appIdentifier,
				runner,
				marker,
				markerKey,
				expectedUrl: kickoff.from,
				deadlineMs: Date.now() + 10_000,
			})
		);
	});
}

function waitForReloadPollDelay(): ResultAsync<null, TauriMcpFailure> {
	return ResultAsync.fromPromise(
		new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
		(error) => ({
			code: "reload_poll_delay_failed",
			message: error instanceof Error ? error.message : "Reload poll delay failed.",
		})
	);
}

function pollReloadReadiness(input: {
	readonly appIdentifier: string;
	readonly runner: CommandRunner;
	readonly marker: string;
	readonly markerKey: string;
	readonly expectedUrl: string;
	readonly deadlineMs: number;
}): ResultAsync<NavigateResult, TauriMcpFailure> {
	const script = `
(() => {
  const marker = sessionStorage.getItem(${escapedJson(input.markerKey)});
  if (
    marker !== ${escapedJson(input.marker)} ||
    window.__acepeQaReloadPendingMarker === ${escapedJson(input.marker)} ||
    document.readyState !== "complete" ||
    window.location.href !== ${escapedJson(input.expectedUrl)}
  ) {
    throw new Error("Reloaded WebView is not ready.");
  }
  sessionStorage.removeItem(${escapedJson(input.markerKey)});
  return {
    from: ${escapedJson(input.expectedUrl)},
    to: window.location.href,
    path: window.location.pathname + window.location.search + window.location.hash,
  };
})()
`;
	return executeWebviewJson(
		{
			appIdentifier: input.appIdentifier,
			script,
			schema: navigateResultSchema,
			callTimeoutMs: 1_500,
		},
		input.runner
	).orElse((failure) => {
		if (Date.now() >= input.deadlineMs) {
			return err({
				code: "reload_webview_timeout",
				message: `Reloaded WebView did not become ready: ${failure.message}`,
			});
		}
		return waitForReloadPollDelay().andThen(() => pollReloadReadiness(input));
	});
}

export function probePanelResize(
	options: DriverOptions & {
		readonly dx: number;
		readonly steps: number;
		readonly stepDelayMs: number;
	}
): ResultAsync<ResizeProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
	(async () => {
	  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	  const nextFrame = () => new Promise((resolve) => requestAnimationFrame((time) => resolve(time)));
	  const rectOf = (node) => {
	    const rect = node.getBoundingClientRect();
	    return {
	      x: rect.x,
	      y: rect.y,
	      width: rect.width,
	      height: rect.height,
	      top: rect.top,
	      right: rect.right,
	      bottom: rect.bottom,
	      left: rect.left,
	    };
	  };
	  const isVisible = (node) => {
	    const style = getComputedStyle(node);
	    const rect = node.getBoundingClientRect();
	    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
	  };
	  const emptyResult = (edgeRect, panelRectBefore) => ({
	    found: false,
	    edgeRect,
	    panelRectBefore,
	    panelRectAfter: null,
	    requestedDelta: ${options.dx.toString()},
	    steps: ${options.steps.toString()},
	    stepDelayMs: ${options.stepDelayMs.toString()},
	    originalWidth: panelRectBefore ? panelRectBefore.width : null,
	    finalWidthBeforeRestore: null,
	    restoredWidth: null,
	    observedDeltaBeforeRestore: null,
	    finalLagPx: null,
	    maxImmediateLagPx: null,
	    maxFrameLagPx: null,
	    avgFrameDelayMs: null,
	    maxFrameDelayMs: null,
	    transitionProperty: null,
	    transitionDuration: null,
	    samples: [],
	  });
	  const edge = Array.from(document.querySelectorAll("[class*='cursor-col-resize'], [class*='cursor-ew-resize']"))
	    .find(isVisible) || null;
	  if (!edge) {
	    return emptyResult(null, null);
	  }
	  const panel = edge.closest("[style*='min-width'][style*='max-width']") ||
	    Array.from(document.querySelectorAll("[style*='min-width'][style*='max-width']")).find(isVisible) ||
	    null;
	  if (!panel) {
	    return emptyResult(rectOf(edge), null);
	  }
	  const requestedDelta = ${options.dx.toString()};
	  const steps = Math.max(1, ${options.steps.toString()});
	  const stepDelayMs = Math.max(0, ${options.stepDelayMs.toString()});
	  const edgeRect = rectOf(edge);
	  const panelRectBefore = rectOf(panel);
	  const styleBefore = getComputedStyle(panel);
	  const originalWidth = panelRectBefore.width;
	  const startX = edgeRect.left + edgeRect.width / 2;
	  const startY = edgeRect.top + edgeRect.height / 2;
	  const pointerId = 1007;
	  const originalSetPointerCapture = edge.setPointerCapture;
	  const originalReleasePointerCapture = edge.releasePointerCapture;
	  edge.setPointerCapture = () => undefined;
	  edge.releasePointerCapture = () => undefined;
	  const dispatchPointer = (type, clientX) => {
	    const event = new PointerEvent(type, {
	      bubbles: true,
	      cancelable: true,
	      view: window,
	      pointerId,
	      pointerType: "mouse",
	      isPrimary: true,
	      buttons: type === "pointerup" ? 0 : 1,
	      button: 0,
	      clientX,
	      clientY: startY,
	    });
	    edge.dispatchEvent(event);
	  };
	  const samples = [];
	  const startedAt = performance.now();
	  dispatchPointer("pointerdown", startX);
	  await Promise.resolve();
	  await nextFrame();
	  for (let step = 1; step <= steps; step += 1) {
	    const stepStartedAt = performance.now();
	    const targetDelta = requestedDelta * step / steps;
	    const expectedWidth = Math.max(400, originalWidth + targetDelta);
	    dispatchPointer("pointermove", startX + targetDelta);
	    const immediateWidth = panel.getBoundingClientRect().width;
	    const afterDispatchAt = performance.now();
	    await Promise.resolve();
	    const microtaskWidth = panel.getBoundingClientRect().width;
	    const frameAt = await nextFrame();
	    const frameWidth = panel.getBoundingClientRect().width;
	    samples.push({
	      step,
	      elapsedMs: Math.round(performance.now() - startedAt),
	      targetDelta,
	      expectedWidth,
	      immediateWidth,
	      microtaskWidth,
	      frameWidth,
	      dispatchMs: afterDispatchAt - stepStartedAt,
	      frameDelayMs: Number(frameAt) - stepStartedAt,
	    });
	    const remainingDelay = stepDelayMs - (performance.now() - stepStartedAt);
	    if (remainingDelay > 0) {
	      await sleep(remainingDelay);
	    }
	  }
	  dispatchPointer("pointerup", startX + requestedDelta);
	  await Promise.resolve();
	  await nextFrame();
	  const panelRectAfter = rectOf(panel);
	  const finalWidthBeforeRestore = panelRectAfter.width;
	  const observedDeltaBeforeRestore = finalWidthBeforeRestore - originalWidth;
	  const waitForWidthNear = async (targetWidth) => {
	    let width = panel.getBoundingClientRect().width;
	    for (let attempt = 0; attempt < 12 && Math.abs(width - targetWidth) > 1; attempt += 1) {
	      await nextFrame();
	      width = panel.getBoundingClientRect().width;
	    }
	    return width;
	  };
	  const restoreEdge = Array.from(document.querySelectorAll("[class*='cursor-col-resize'], [class*='cursor-ew-resize']"))
	    .find(isVisible) || edge;
	  const restoreEdgeRect = rectOf(restoreEdge);
	  const restoreStartX = restoreEdgeRect.left + restoreEdgeRect.width / 2;
	  const restoreY = restoreEdgeRect.top + restoreEdgeRect.height / 2;
	  const restoreDelta = originalWidth - finalWidthBeforeRestore;
	  const restoreSetPointerCapture = restoreEdge.setPointerCapture;
	  const restoreReleasePointerCapture = restoreEdge.releasePointerCapture;
	  restoreEdge.setPointerCapture = () => undefined;
	  restoreEdge.releasePointerCapture = () => undefined;
	  const restoreDispatch = (type, clientX) => {
	    const event = new PointerEvent(type, {
	      bubbles: true,
	      cancelable: true,
	      view: window,
	      pointerId: pointerId + 1,
	      pointerType: "mouse",
	      isPrimary: true,
	      buttons: type === "pointerup" ? 0 : 1,
	      button: 0,
	      clientX,
	      clientY: restoreY,
	    });
	    restoreEdge.dispatchEvent(event);
	  };
	  restoreDispatch("pointerdown", restoreStartX);
	  restoreDispatch("pointermove", restoreStartX + restoreDelta);
	  restoreDispatch("pointerup", restoreStartX + restoreDelta);
	  await Promise.resolve();
	  await sleep(500);
	  const restoredWidth = await waitForWidthNear(originalWidth);
	  restoreEdge.setPointerCapture = restoreSetPointerCapture;
	  restoreEdge.releasePointerCapture = restoreReleasePointerCapture;
	  edge.setPointerCapture = originalSetPointerCapture;
	  edge.releasePointerCapture = originalReleasePointerCapture;
	  const immediateLagValues = samples.map((sample) => Math.abs(sample.expectedWidth - sample.immediateWidth));
	  const frameLagValues = samples.map((sample) => Math.abs(sample.expectedWidth - sample.frameWidth));
	  const frameDelayValues = samples.map((sample) => sample.frameDelayMs);
	  const maxImmediateLagPx = immediateLagValues.length === 0 ? null : Math.max(...immediateLagValues);
	  const maxFrameLagPx = frameLagValues.length === 0 ? null : Math.max(...frameLagValues);
	  const maxFrameDelayMs = frameDelayValues.length === 0 ? null : Math.max(...frameDelayValues);
	  const avgFrameDelayMs = frameDelayValues.length === 0
	    ? null
	    : frameDelayValues.reduce((sum, value) => sum + value, 0) / frameDelayValues.length;
	  return {
	    found: true,
	    edgeRect,
	    panelRectBefore,
	    panelRectAfter,
	    requestedDelta,
	    steps,
	    stepDelayMs,
	    originalWidth,
	    finalWidthBeforeRestore,
	    restoredWidth,
	    observedDeltaBeforeRestore,
	    finalLagPx: Math.abs(Math.max(400, originalWidth + requestedDelta) - finalWidthBeforeRestore),
	    maxImmediateLagPx,
	    maxFrameLagPx,
	    avgFrameDelayMs,
	    maxFrameDelayMs,
	    transitionProperty: styleBefore.transitionProperty,
	    transitionDuration: styleBefore.transitionDuration,
	    samples,
	  };
	})()
	`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: resizeProbeResultSchema,
				callTimeoutMs: 20_000,
			},
			runner
		);
	});
}

export function probePanelResizeStream(
	options: DriverOptions & {
		readonly dx: number;
		readonly durationMs: number;
		readonly moveIntervalMs: number;
	}
): ResultAsync<ResizeStreamProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
	(async () => {
	  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	  const nextFrame = () => new Promise((resolve) => requestAnimationFrame((time) => resolve(time)));
	  const rectOf = (node) => {
	    const rect = node.getBoundingClientRect();
	    return {
	      x: rect.x,
	      y: rect.y,
	      width: rect.width,
	      height: rect.height,
	      top: rect.top,
	      right: rect.right,
	      bottom: rect.bottom,
	      left: rect.left,
	    };
	  };
	  const isVisible = (node) => {
	    const style = getComputedStyle(node);
	    const rect = node.getBoundingClientRect();
	    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
	  };
	  const emptyResult = (edgeRect, panelRectBefore) => ({
	    found: false,
	    edgeRect,
	    panelRectBefore,
	    panelRectAfter: null,
	    requestedDelta: ${options.dx.toString()},
	    durationMs: ${options.durationMs.toString()},
	    moveIntervalMs: ${options.moveIntervalMs.toString()},
	    originalWidth: panelRectBefore ? panelRectBefore.width : null,
	    finalWidthBeforeRestore: null,
	    restoredWidth: null,
	    moveCount: 0,
	    frameCount: 0,
	    maxLagPx: null,
	    avgLagPx: null,
	    maxFrameIntervalMs: null,
	    avgFrameIntervalMs: null,
	    framesOver50Ms: 0,
	    transitionProperty: null,
	    transitionDuration: null,
	    samples: [],
	  });
	  const edge = Array.from(document.querySelectorAll("[class*='cursor-col-resize'], [class*='cursor-ew-resize']"))
	    .find(isVisible) || null;
	  if (!edge) {
	    return emptyResult(null, null);
	  }
	  const panel = edge.closest("[style*='min-width'][style*='max-width']") ||
	    Array.from(document.querySelectorAll("[style*='min-width'][style*='max-width']")).find(isVisible) ||
	    null;
	  if (!panel) {
	    return emptyResult(rectOf(edge), null);
	  }

	  const requestedDelta = ${options.dx.toString()};
	  const durationMs = Math.max(50, ${options.durationMs.toString()});
	  const moveIntervalMs = Math.max(1, ${options.moveIntervalMs.toString()});
	  const edgeRect = rectOf(edge);
	  const panelRectBefore = rectOf(panel);
	  const styleBefore = getComputedStyle(panel);
	  const originalWidth = panelRectBefore.width;
	  const startX = edgeRect.left + edgeRect.width / 2;
	  const startY = edgeRect.top + edgeRect.height / 2;
	  const pointerId = 1009;
	  const originalSetPointerCapture = edge.setPointerCapture;
	  const originalReleasePointerCapture = edge.releasePointerCapture;
	  edge.setPointerCapture = () => undefined;
	  edge.releasePointerCapture = () => undefined;
	  const dispatchPointer = (type, clientX) => {
	    const event = new PointerEvent(type, {
	      bubbles: true,
	      cancelable: true,
	      view: window,
	      pointerId,
	      pointerType: "mouse",
	      isPrimary: true,
	      buttons: type === "pointerup" ? 0 : 1,
	      button: 0,
	      clientX,
	      clientY: startY,
	    });
	    edge.dispatchEvent(event);
	  };

	  const samples = [];
	  const frameIntervals = [];
	  let moveCount = 0;
	  let latestExpectedWidth = originalWidth;
	  let lastFrameAt = null;
	  let frameCount = 0;
	  const startedAt = performance.now();
	  dispatchPointer("pointerdown", startX);
	  await Promise.resolve();

	  const moveTimer = window.setInterval(() => {
	    const elapsedMs = performance.now() - startedAt;
	    const progress = Math.min(1, elapsedMs / durationMs);
	    const targetDelta = requestedDelta * progress;
	    latestExpectedWidth = Math.max(400, originalWidth + targetDelta);
	    dispatchPointer("pointermove", startX + targetDelta);
	    moveCount += 1;
	    if (progress >= 1) {
	      window.clearInterval(moveTimer);
	    }
	  }, moveIntervalMs);

	  while (performance.now() - startedAt < durationMs + 80) {
	    const frameAt = await nextFrame();
	    frameCount += 1;
	    if (lastFrameAt !== null) {
	      frameIntervals.push(Number(frameAt) - lastFrameAt);
	    }
	    lastFrameAt = Number(frameAt);
	    const width = panel.getBoundingClientRect().width;
	    samples.push({
	      elapsedMs: Math.round(performance.now() - startedAt),
	      expectedWidth: latestExpectedWidth,
	      width,
	      lagPx: Math.abs(latestExpectedWidth - width),
	    });
	  }

	  window.clearInterval(moveTimer);
	  latestExpectedWidth = Math.max(400, originalWidth + requestedDelta);
	  dispatchPointer("pointermove", startX + requestedDelta);
	  dispatchPointer("pointerup", startX + requestedDelta);
	  await Promise.resolve();
	  await nextFrame();
	  const panelRectAfter = rectOf(panel);
	  const finalWidthBeforeRestore = panelRectAfter.width;

	  const restoreEdge = Array.from(document.querySelectorAll("[class*='cursor-col-resize'], [class*='cursor-ew-resize']"))
	    .find(isVisible) || edge;
	  const restoreEdgeRect = rectOf(restoreEdge);
	  const restoreStartX = restoreEdgeRect.left + restoreEdgeRect.width / 2;
	  const restoreY = restoreEdgeRect.top + restoreEdgeRect.height / 2;
	  const restorePointerId = pointerId + 1;
	  const restoreSetPointerCapture = restoreEdge.setPointerCapture;
	  const restoreReleasePointerCapture = restoreEdge.releasePointerCapture;
	  restoreEdge.setPointerCapture = () => undefined;
	  restoreEdge.releasePointerCapture = () => undefined;
	  const restoreDispatch = (type, clientX) => {
	    const event = new PointerEvent(type, {
	      bubbles: true,
	      cancelable: true,
	      view: window,
	      pointerId: restorePointerId,
	      pointerType: "mouse",
	      isPrimary: true,
	      buttons: type === "pointerup" ? 0 : 1,
	      button: 0,
	      clientX,
	      clientY: restoreY,
	    });
	    restoreEdge.dispatchEvent(event);
	  };
	  const restoreDelta = originalWidth - finalWidthBeforeRestore;
	  restoreDispatch("pointerdown", restoreStartX);
	  restoreDispatch("pointermove", restoreStartX + restoreDelta);
	  restoreDispatch("pointerup", restoreStartX + restoreDelta);
	  await sleep(500);
	  let restoredWidth = panel.getBoundingClientRect().width;
	  for (let attempt = 0; attempt < 12 && Math.abs(restoredWidth - originalWidth) > 1; attempt += 1) {
	    await nextFrame();
	    restoredWidth = panel.getBoundingClientRect().width;
	  }

	  restoreEdge.setPointerCapture = restoreSetPointerCapture;
	  restoreEdge.releasePointerCapture = restoreReleasePointerCapture;
	  edge.setPointerCapture = originalSetPointerCapture;
	  edge.releasePointerCapture = originalReleasePointerCapture;

	  const lagValues = samples.map((sample) => sample.lagPx);
	  const maxLagPx = lagValues.length === 0 ? null : Math.max(...lagValues);
	  const avgLagPx = lagValues.length === 0
	    ? null
	    : lagValues.reduce((sum, value) => sum + value, 0) / lagValues.length;
	  const maxFrameIntervalMs = frameIntervals.length === 0 ? null : Math.max(...frameIntervals);
	  const avgFrameIntervalMs = frameIntervals.length === 0
	    ? null
	    : frameIntervals.reduce((sum, value) => sum + value, 0) / frameIntervals.length;
	  return {
	    found: true,
	    edgeRect,
	    panelRectBefore,
	    panelRectAfter,
	    requestedDelta,
	    durationMs,
	    moveIntervalMs,
	    originalWidth,
	    finalWidthBeforeRestore,
	    restoredWidth,
	    moveCount,
	    frameCount,
	    maxLagPx,
	    avgLagPx,
	    maxFrameIntervalMs,
	    avgFrameIntervalMs,
	    framesOver50Ms: frameIntervals.filter((value) => value > 50).length,
	    transitionProperty: styleBefore.transitionProperty,
	    transitionDuration: styleBefore.transitionDuration,
	    samples,
	  };
	})()
	`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: resizeStreamProbeResultSchema,
				callTimeoutMs: 20_000,
			},
			runner
		);
	});
}

export function probeThinkingToggle(
	options: DriverOptions
): ResultAsync<ThinkingToggleProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (node) => node ? (node.textContent || "").trim().replace(/\\s+/g, " ") : null;
  const sample = (label) => {
    const expandButtons = Array.from(document.querySelectorAll("[aria-label='Expand thinking']"));
    const collapseButtons = Array.from(document.querySelectorAll("[aria-label='Collapse thinking']"));
    const contents = Array.from(document.querySelectorAll("[data-testid='thinking-block-content']"));
    const firstButton = collapseButtons[0] || expandButtons[0] || null;
    const firstContent = contents[0] || null;
    return {
      label,
      expandCount: expandButtons.length,
      collapseCount: collapseButtons.length,
      contentCount: contents.length,
      firstButtonName: firstButton ? firstButton.getAttribute("aria-label") : null,
      firstContentText: normalize(firstContent),
    };
  };
  const target = document.querySelector("[aria-label='Expand thinking']");
  const samples = [sample("before")];
  if (!target) {
    return { found: false, clicked: false, samples };
  }
  target.scrollIntoView({ block: "center", inline: "nearest" });
  await sleep(100);
  const rect = target.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  if (typeof PointerEvent === "function") {
    target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
  }
  target.dispatchEvent(new MouseEvent("mousedown", eventInit));
  if (typeof PointerEvent === "function") {
    target.dispatchEvent(new PointerEvent("pointerup", eventInit));
  }
  target.dispatchEvent(new MouseEvent("mouseup", eventInit));
  target.click();
  samples.push(sample("after-click"));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  samples.push(sample("after-raf"));
  await sleep(100);
  samples.push(sample("after-100ms"));
  await sleep(400);
  samples.push(sample("after-500ms"));
  return { found: true, clicked: true, samples };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: thinkingToggleProbeResultSchema,
				callTimeoutMs: 10_000,
			},
			runner
		);
	});
}

export function resetOnboarding(
	options: DriverOptions & {
		readonly delayMs: number;
	}
): ResultAsync<ResetOnboardingResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const qaText = (node) => node ? (node.textContent || "").trim().replace(/\\s+/g, " ") : "";
  const devButton = Array.from(document.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Dev Tools") || null;
  if (devButton) devButton.click();
  await sleep(140);
  const resetItem = Array.from(document.querySelectorAll("[role=menuitem], button, div")).find((node) => qaText(node) === "Reset Onboarding") || null;
  if (resetItem) resetItem.click();
  await sleep(${options.delayMs.toString()});
  const animated = Array.from(document.querySelectorAll(".onboarding-preview-panel *"))
    .map((node) => ({
      className: typeof node.className === "string" ? node.className : "",
      animationName: getComputedStyle(node).animationName,
    }))
    .filter((entry) => entry.animationName !== "none")
    .slice(0, 20);
  return {
    clickedDevTools: Boolean(devButton),
    clickedReset: Boolean(resetItem),
    hasWelcome: document.body.innerText.includes("Welcome to Acepe"),
    panelCount: document.querySelectorAll(".onboarding-preview-panel").length,
    animated,
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: resetOnboardingResultSchema,
				callTimeoutMs: 20_000,
			},
			runner
		);
	});
}

export function openStreamingReproLab(
	options: DriverOptions & {
		readonly delayMs: number;
	}
): ResultAsync<StreamingReproLabResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const open = window.__acepeOpenStreamingReproLab;
  const hookAvailable = typeof open === "function";
  const opened = hookAvailable ? open() === true : false;
  await sleep(${options.delayMs.toString()});
  const lab = document.querySelector('[data-testid="streaming-repro-lab"]');
  const phaseLabel = lab
    ? (Array.from(lab.querySelectorAll("div")).map((node) => (node.textContent || "").trim().replace(/\\s+/g, " ")).find((text) => text.includes("Step ")) || null)
    : null;
  const tokenRevealNode = document.querySelector("[data-token-reveal-mode]");
  const performanceProbe = window.__acepeStreamingReproPerfProbe;
  const performanceResult = typeof performanceProbe === "function"
    ? await performanceProbe().catch(() => null)
    : null;
  return {
    hookAvailable,
    opened,
    labPresent: Boolean(lab),
    phaseLabel,
    tokenRevealAnimatedCount: document.querySelectorAll('[data-sd-animate="true"], [data-acepe-token-reveal-tail="true"]').length,
    tokenRevealMode: tokenRevealNode ? tokenRevealNode.getAttribute("data-token-reveal-mode") : null,
    performance: performanceResult,
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: streamingReproLabResultSchema,
				callTimeoutMs: 20_000,
			},
			runner
		);
	});
}

export function openAgentPanelStressLab(
	options: DriverOptions & {
		readonly rowCount: number;
		readonly preset: string;
		readonly rendererMode: string;
		readonly seed: number;
		readonly includeStreamingTail: boolean;
		readonly runScrollSample: boolean;
		readonly delayMs: number;
		readonly timeoutMs: number;
	}
): ResultAsync<AgentPanelStressLabResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() =>
		ResultAsync.fromPromise(
			(async () => {
				const started = await executeWebviewJson(
					{
						appIdentifier: options.appIdentifier,
						script: startAgentPanelStressLabScript(options),
						schema: agentPanelStressLabRunStatusSchema,
						callTimeoutMs: 5_000,
					},
					runner
				).match(
					(value) => value,
					(error) => {
						throw new AgentPanelStressLabProbeError(error);
					}
				);
				if (started.status === "done" && started.result !== null) {
					return started.result;
				}
				if (started.status === "error" || started.runId === null) {
					throw new AgentPanelStressLabProbeError({
						code: "agent_panel_stress_lab_start_failed",
						message: started.message ?? "Unable to start the Agent Panel Stress Lab.",
					});
				}

				const startedAtMs = Date.now();
				let status: AgentPanelStressLabRunStatus = started;
				while (Date.now() - startedAtMs < options.timeoutMs) {
					await sleepMs(250);
					status = await readAgentPanelStressLabRunStatus(
						options.appIdentifier,
						started.runId,
						runner
					);
					if (status.status === "done" && status.result !== null) {
						return status.result;
					}
					if (status.status === "error" || status.status === "missing") {
						throw new AgentPanelStressLabProbeError({
							code: "agent_panel_stress_lab_run_failed",
							message: status.message ?? "Agent Panel Stress Lab run did not finish.",
						});
					}
				}

				throw new AgentPanelStressLabProbeError({
					code: "agent_panel_stress_lab_timeout",
					message: `Agent Panel Stress Lab did not finish within ${options.timeoutMs.toString()}ms.`,
				});
			})(),
			(error) =>
				error instanceof AgentPanelStressLabProbeError
					? error.failure
					: {
							code: "agent_panel_stress_lab_failed",
							message:
								error instanceof Error ? error.message : "Unable to collect stress lab metrics.",
						}
		)
	);
}

export function probeSendAttachStress(
	options: DriverOptions & {
		readonly rowCount: number;
		readonly preScrollOffsetPx: number;
		readonly delayMs: number;
	}
): ResultAsync<SendAttachStressProbeResult, TauriMcpFailure> {
	const runner = options.runner === undefined ? runCommand : options.runner;
	const script = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const route = "/test-agent-panel-stress";
  const targetUrl = new URL(route, window.location.origin);
  const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
  const currentWindow = tauriWindow && typeof tauriWindow.getCurrentWindow === "function"
    ? tauriWindow.getCurrentWindow()
    : null;
  if (currentWindow && typeof currentWindow.setFocus === "function") {
    await currentWindow.setFocus().catch(() => undefined);
    await sleep(150);
  }
  if (window.location.pathname !== route) {
    const anchor = document.createElement("a");
    anchor.href = targetUrl.href;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    anchor.remove();
    for (let attempt = 0; attempt < 30 && window.location.pathname !== route; attempt += 1) {
      await sleep(50);
    }
  }
  await sleep(${options.delayMs.toString()});
  let hook = window.__agentPanelStressLab || null;
  for (let attempt = 0; attempt < 40 && !(hook && typeof hook.runSendAttachScenario === "function"); attempt += 1) {
    await sleep(50);
    hook = window.__agentPanelStressLab || null;
  }
  if (!(hook && typeof hook.runSendAttachScenario === "function")) {
    return {
      hookAvailable: false,
      opened: window.location.pathname === route,
      labPresent: Boolean(document.querySelector('[data-testid="agent-panel-stress-lab"]')),
      route,
      requestedRowCount: ${options.rowCount.toString()},
      rowCount: 0,
      requestedPreScrollOffsetPx: ${options.preScrollOffsetPx.toString()},
      preconditionPassed: false,
      passed: false,
      maxExtentCollapsePx: 0,
      nativeClampDetected: false,
      stableRowShellPreserved: false,
      samples: [],
    };
  }
  return hook.runSendAttachScenario({
    rowCount: ${options.rowCount.toString()},
    preScrollOffsetPx: ${options.preScrollOffsetPx.toString()},
  });
})()
`;
	return driverReady(options).andThen(() =>
		executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: sendAttachStressProbeResultSchema,
				callTimeoutMs: 20_000,
			},
			runner
		)
	);
}

export function probePlanningBetweenTools(
	options: DriverOptions & {
		readonly delayMs: number;
	}
): ResultAsync<PlanningBetweenToolsProbeResult, TauriMcpFailure> {
	const runner = options.runner === undefined ? runCommand : options.runner;
	const script = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const route = "/test-agent-panel-stress";
  const targetUrl = new URL(route, window.location.origin);
  const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
  const currentWindow = tauriWindow && typeof tauriWindow.getCurrentWindow === "function"
    ? tauriWindow.getCurrentWindow()
    : null;
  if (currentWindow && typeof currentWindow.setFocus === "function") {
    await currentWindow.setFocus().catch(() => undefined);
    await sleep(150);
  }
  if (window.location.pathname !== route) {
    const anchor = document.createElement("a");
    anchor.href = targetUrl.href;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    anchor.remove();
    for (let attempt = 0; attempt < 30 && window.location.pathname !== route; attempt += 1) {
      await sleep(50);
    }
  }
  await sleep(${options.delayMs.toString()});
  let hook = window.__agentPanelStressLab || null;
  for (let attempt = 0; attempt < 40 && !(hook && typeof hook.runPlanningBetweenToolsScenario === "function"); attempt += 1) {
    await sleep(50);
    hook = window.__agentPanelStressLab || null;
  }
  if (!(hook && typeof hook.runPlanningBetweenToolsScenario === "function")) {
    return {
      hookAvailable: false,
      opened: window.location.pathname === route,
      labPresent: Boolean(document.querySelector('[data-testid="agent-panel-stress-lab"]')),
      route,
      passed: false,
      restoredCompletedToolStage: false,
      samples: [],
    };
  }
  return hook.runPlanningBetweenToolsScenario();
})()
`;
	return driverReady(options).andThen(() =>
		executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: planningBetweenToolsProbeResultSchema,
				callTimeoutMs: 20_000,
			},
			runner
		)
	);
}

function stressLabResultHelpersScript(): string {
	return `
  const stressLabResultFromDump = (dump) => ({
    hookAvailable: true,
    opened: window.location.pathname === "/test-agent-panel-stress",
    labPresent: Boolean(document.querySelector('[data-testid="agent-panel-stress-lab"]')),
    route: dump.route,
    preset: dump.preset,
    rendererMode: dump.rendererMode || "full",
    rowCount: dump.rowCount,
    seed: dump.seed,
    renderSettleMs: dump.metrics.renderSettleMs,
    domRowCount: dump.metrics.domRowCount,
    scrollToTopMs: dump.metrics.scrollToTopMs,
    scrollToBottomMs: dump.metrics.scrollToBottomMs,
    frameSampleCount: dump.summary.frameSampleCount,
    jankFrameCount: dump.summary.jankFrameCount,
    averageFrameDeltaMs: dump.summary.averageFrameDeltaMs,
    maxFrameDeltaMs: dump.summary.maxFrameDeltaMs,
    estimatedFps: dump.summary.estimatedFps,
    frameSamplingLikelyThrottled: dump.summary.frameSamplingLikelyThrottled,
    frameEnvironmentLabel: dump.summary.frameEnvironmentLabel,
    memoryLabel: dump.summary.memoryLabel,
    dump,
  });
  const stressLabUnavailableResult = (opened, labPresent) => ({
    hookAvailable: false,
    opened,
    labPresent,
    route: null,
    preset: null,
    rendererMode: null,
    rowCount: null,
    seed: null,
    renderSettleMs: null,
    domRowCount: null,
    scrollToTopMs: null,
    scrollToBottomMs: null,
    frameSampleCount: 0,
    jankFrameCount: 0,
    averageFrameDeltaMs: null,
    maxFrameDeltaMs: null,
    estimatedFps: null,
    frameSamplingLikelyThrottled: null,
    frameEnvironmentLabel: null,
    memoryLabel: null,
    dump: null,
  });
`;
}

function startAgentPanelStressLabScript(
	options: DriverOptions & {
		readonly rowCount: number;
		readonly preset: string;
		readonly rendererMode: string;
		readonly seed: number;
		readonly includeStreamingTail: boolean;
		readonly runScrollSample: boolean;
		readonly delayMs: number;
	}
): string {
	return `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const route = "/test-agent-panel-stress";
  const targetUrl = new URL(route, window.location.origin);
  const rowCount = ${options.rowCount.toString()};
  const preset = ${escapedJson(options.preset)};
  const rendererMode = ${escapedJson(options.rendererMode)};
  const seed = ${options.seed.toString()};
  const includeStreamingTail = ${options.includeStreamingTail ? "true" : "false"};
  const shouldRunScrollSample = ${options.runScrollSample ? "true" : "false"};
  const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
  const currentWindow =
    tauriWindow &&
    typeof tauriWindow.getCurrentWindow === "function" &&
    tauriWindow.getCurrentWindow();
  if (currentWindow && typeof currentWindow.setFocus === "function") {
    await currentWindow.setFocus().catch(() => undefined);
    await sleep(150);
  }
  if (window.location.pathname !== route) {
    const anchor = document.createElement("a");
    anchor.href = targetUrl.href;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    anchor.remove();
    for (let attempt = 0; attempt < 30 && window.location.pathname !== route; attempt += 1) {
      await sleep(50);
    }
  }
  await sleep(${options.delayMs.toString()});
  ${stressLabResultHelpersScript()}
  const lab = document.querySelector('[data-testid="agent-panel-stress-lab"]');
  let hook = window.__agentPanelStressLab || null;
  for (let attempt = 0; attempt < 40 && !(hook && typeof hook.runScenario === "function"); attempt += 1) {
    await sleep(50);
    hook = window.__agentPanelStressLab || null;
  }
  const hookAvailable = Boolean(hook && typeof hook.runScenario === "function");
  if (!hookAvailable) {
    return {
      runId: null,
      status: "done",
      message: null,
      result: stressLabUnavailableResult(window.location.pathname === route, Boolean(lab)),
    };
  }
  const runId = "agent-panel-stress-" + Date.now().toString() + "-" + Math.round(Math.random() * 1000000).toString();
  const runs = window.__agentPanelStressLabRuns || {};
  window.__agentPanelStressLabRuns = runs;
  runs[runId] = { status: "running", message: null, result: null };
  setTimeout(() => {
    const activeHook = window.__agentPanelStressLab || hook;
    if (!activeHook || typeof activeHook.runScenario !== "function") {
      runs[runId] = { status: "error", message: "Stress lab hook disappeared.", result: null };
      return;
    }
    activeHook.runScenario({
      rowCount,
      preset,
      rendererMode,
      seed,
      includeStreamingTail,
      runScrollSample: shouldRunScrollSample,
    }).then((dump) => {
      runs[runId] = { status: "done", message: null, result: stressLabResultFromDump(dump) };
    }, (error) => {
      const message = error && typeof error.message === "string" ? error.message : String(error);
      runs[runId] = { status: "error", message, result: null };
    });
  }, 0);
  return {
    runId,
    status: "running",
    message: null,
    result: null,
  };
})()
`;
}

async function readAgentPanelStressLabRunStatus(
	appIdentifier: string,
	runId: string,
	runner: CommandRunner
): Promise<AgentPanelStressLabRunStatus> {
	return executeWebviewJson(
		{
			appIdentifier,
			script: `
(() => {
  const runId = ${escapedJson(runId)};
  const runs = window.__agentPanelStressLabRuns || {};
  const run = runs[runId] || null;
  if (!run) {
    return { runId, status: "missing", message: "No Agent Panel Stress Lab run found.", result: null };
  }
  return {
    runId,
    status: run.status || "missing",
    message: run.message || null,
    result: run.result || null,
  };
})()
`,
			schema: agentPanelStressLabRunStatusSchema,
			callTimeoutMs: 5_000,
		},
		runner
	).match(
		(value) => value,
		(error) => {
			if (error.code === "tauri_payload_not_json" || error.code === "qa_daemon_request_failed") {
				return {
					runId,
					status: "running",
					message: null,
					result: null,
				};
			}
			throw new AgentPanelStressLabProbeError(error);
		}
	);
}

// Type a prompt into the agent-panel composer (contenteditable, so real input
// events are dispatched, not synthetic keystrokes) and optionally click send.
export function sendComposer(
	options: DriverOptions & {
		readonly text: string;
		readonly submit: boolean;
		readonly selector: string;
		readonly selectorIndex: number;
		readonly panelId?: string;
		readonly sessionId?: string;
	}
): ResultAsync<SendComposerResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const promptText = ${escapedJson(options.text)};
  const submit = ${options.submit ? "true" : "false"};
  const selector = ${escapedJson(options.selector)};
  const selectorIndex = ${Math.max(0, Math.floor(options.selectorIndex)).toString()};
  const panelId = ${escapedJson(options.panelId ?? "")};
  const sessionId = ${escapedJson(options.sessionId ?? "")};
  const composerSelector = selector.length > 0 ? selector : "[contenteditable=true]";
  const rankCandidate = (node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + Math.min(rect.width - 1, Math.max(1, rect.width / 2)), rect.top + Math.min(rect.height - 1, Math.max(1, rect.height / 2)));
    return node === hit || node.contains(hit) ? 0 : 1;
  };
  const panelRoots = Array.from(document.querySelectorAll("[data-qa-agent-panel-id]"));
  const targetRoot = panelId.length > 0 || sessionId.length > 0
    ? panelRoots.find((root) => {
        const rootPanelId = root.getAttribute("data-qa-agent-panel-id") || "";
        const rootSessionId = root.getAttribute("data-session-id")
          || root.querySelector("[data-session-id]")?.getAttribute("data-session-id")
          || "";
        return (panelId.length === 0 || rootPanelId === panelId)
          && (sessionId.length === 0 || rootSessionId === sessionId);
      }) || null
    : null;
  const searchRoot = targetRoot || (panelId.length > 0 || sessionId.length > 0 ? null : document);
  const candidates = searchRoot
    ? Array.from(searchRoot.querySelectorAll(composerSelector)).sort((left, right) => rankCandidate(left) - rankCandidate(right))
    : [];
  const visibleCandidates = candidates.filter((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  });
  const ce = visibleCandidates[selectorIndex] || null;
  if (!ce) return { composerFound: false, textApplied: "", sendReady: false, sent: false };
  ce.focus();
  if (ce instanceof HTMLTextAreaElement || ce instanceof HTMLInputElement) {
    ce.value = promptText;
    ce.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: promptText }));
  } else {
    const sel = getSelection(); sel.removeAllRanges();
    const range = document.createRange(); range.selectNodeContents(ce); sel.addRange(range);
    if (typeof DataTransfer === "function" && typeof ClipboardEvent === "function") {
      const data = new DataTransfer();
      data.setData("text/plain", promptText);
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: data });
      ce.dispatchEvent(paste);
    } else {
      ce.textContent = promptText;
      ce.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: promptText }));
    }
  }
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const isVisible = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const sendButtonName = (button) => (button.getAttribute("aria-label") || button.textContent || "").trim().replace(/\\s+/g, " ");
  const findSendForComposer = (target) => {
    let node = target;
    for (let i = 0; i < 10 && node; i += 1) {
      node = node.parentElement;
      if (!node) break;
      const buttons = Array.from(node.querySelectorAll("button")).filter(isVisible);
      const byName = buttons.filter((button) => sendButtonName(button) === "Send message" || sendButtonName(button) === "Send follow-up");
      const candidate = byName.find((button) => !button.disabled)
        || byName[0]
        || buttons.find((button) => button.classList.contains("bg-foreground") && button.classList.contains("text-background") && !button.disabled)
        || buttons.find((button) => button.classList.contains("bg-foreground") && button.classList.contains("text-background"))
        || null;
      if (candidate) return candidate;
    }
    return null;
  };
  const send = findSendForComposer(ce);
  const sendReady = Boolean(send) && !send.disabled;
  let sent = false;
  if (submit && sendReady) { send.click(); sent = true; }
  return { composerFound: true, textApplied: ce.textContent || "", sendReady, sent };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: sendComposerResultSchema,
			},
			runner
		);
	});
}

/**
 * Exercise the manual composer path through the public DOM boundary: type a
 * non-empty draft, observe the canonical submit projection, then dispatch a
 * cancelable plain Enter keydown. A working composer prevents the browser's
 * newline default and publishes the prompt as a user row in the same panel.
 */
export function probeComposerEnterSubmit(
	options: DriverOptions & {
		readonly text: string;
		readonly panelId: string;
		readonly sessionId: string;
	}
): ResultAsync<ComposerEnterSubmitProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const promptText = ${escapedJson(options.text)};
  const panelId = ${escapedJson(options.panelId)};
  const sessionId = ${escapedJson(options.sessionId)};
  const roots = Array.from(document.querySelectorAll("[data-qa-agent-panel-id]"));
  const root = roots.find((candidate) => {
    const candidatePanelId = candidate.getAttribute("data-qa-agent-panel-id") || "";
    const candidateSessionId = candidate.getAttribute("data-session-id")
      || candidate.querySelector("[data-session-id]")?.getAttribute("data-session-id")
      || "";
    return candidatePanelId === panelId && candidateSessionId === sessionId;
  }) || null;
  const planningSnapshot = () => {
    const fn = window.__acepePlanningSnapshot;
    if (typeof fn !== "function") return null;
    const snapshots = fn(sessionId);
    return Array.isArray(snapshots) ? snapshots[0] || null : null;
  };
  if (!root) {
    return {
      targetFound: false,
      composerFound: false,
      textApplied: "",
      sendReadyBeforeEnter: false,
      enterDefaultPrevented: false,
      newlineWouldBeInserted: true,
      draftAfterEnter: "",
      submittedUserRowFound: false,
      planningBefore: planningSnapshot(),
      planningAfter: planningSnapshot(),
    };
  }
  const visible = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden"
      && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const text = (node) => node ? (node.textContent || "").trim().replace(/\\s+/g, " ") : "";
  const composer = Array.from(root.querySelectorAll("[contenteditable=true], textarea, input"))
    .find(visible) || null;
  if (!composer) {
    return {
      targetFound: true,
      composerFound: false,
      textApplied: "",
      sendReadyBeforeEnter: false,
      enterDefaultPrevented: false,
      newlineWouldBeInserted: true,
      draftAfterEnter: "",
      submittedUserRowFound: false,
      planningBefore: planningSnapshot(),
      planningAfter: planningSnapshot(),
    };
  }
  composer.focus();
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    composer.value = promptText;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: promptText }));
  } else {
    const selection = getSelection();
    if (selection) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.addRange(range);
    }
    const data = new DataTransfer();
    data.setData("text/plain", promptText);
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: data });
    composer.dispatchEvent(paste);
  }
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const buttons = Array.from(root.querySelectorAll("button")).filter(visible);
  const send = buttons.find((button) => {
    const name = (button.getAttribute("aria-label") || text(button)).trim();
    return name === "Send message" || name === "Send follow-up";
  }) || null;
  const planningBefore = planningSnapshot();
  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
  });
  composer.dispatchEvent(enter);
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const draftAfterEnter = composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
    ? composer.value
    : text(composer);
  const submittedUserRowFound = Array.from(root.querySelectorAll("*")).some((node) =>
    node !== composer && !composer.contains(node) && node.children.length === 0
      && visible(node) && text(node) === promptText
  );
  return {
    targetFound: true,
    composerFound: true,
    textApplied: promptText,
    sendReadyBeforeEnter: Boolean(send) && !send.disabled,
    enterDefaultPrevented: enter.defaultPrevented,
    newlineWouldBeInserted: !enter.defaultPrevented,
    draftAfterEnter,
    submittedUserRowFound,
    planningBefore,
    planningAfter: planningSnapshot(),
  };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: composerEnterSubmitProbeResultSchema,
				callTimeoutMs: 5_000,
			},
			runner
		);
	});
}

export function probeFirstSendTimeline(
	options: DriverOptions & {
		readonly text: string;
		readonly selector: string;
		readonly panelId: string;
		readonly sessionId: string;
		readonly preScrollOffsetPx?: number | null;
		readonly timeoutMs: number;
	}
): ResultAsync<FirstSendTimelineProbeResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	const preScrollOffsetPx =
		options.preScrollOffsetPx !== undefined &&
		options.preScrollOffsetPx !== null &&
		Number.isFinite(options.preScrollOffsetPx) &&
		options.preScrollOffsetPx > 0
			? Math.round(options.preScrollOffsetPx)
			: null;
	return driverReady(options).andThen(() =>
		executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script: firstSendSubmitScript(
					options.text,
					options.selector,
					options.panelId,
					options.sessionId,
					preScrollOffsetPx,
					options.timeoutMs
				),
				schema: firstSendTimelineProbeResultSchema,
				callTimeoutMs: options.timeoutMs + 5_000,
			},
			runner
		)
	);
}

class AgentPanelStressLabProbeError extends Error {
	constructor(readonly failure: TauriMcpFailure) {
		super(failure.message);
	}
}

function sleepMs(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function firstSendSharedSamplerScript(
	promptExpression: string,
	labelExpression: string,
	panelIdExpression: string,
	sessionIdExpression: string
): string {
	return `
  const probePrompt = ${promptExpression};
  const sampleLabel = ${labelExpression};
  const targetPanelId = ${panelIdExpression};
  const targetSessionId = ${sessionIdExpression};
  const probeState = window.__acepeFirstSendProbe || { startedAt: performance.now() };
  const text = (node) => node ? (node.textContent || "").trim().replace(/\\s+/g, " ") : "";
  const isVisible = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
	const targetPanelRoot = Array.from(document.querySelectorAll("[data-qa-agent-panel-id]")).find((candidate) => {
		const candidatePanelId = candidate.getAttribute("data-qa-agent-panel-id") || "";
		const candidateSessionId = candidate.getAttribute("data-qa-agent-panel-session-id")
			|| candidate.querySelector("[data-session-id]")?.getAttribute("data-session-id")
			|| "";
		return candidatePanelId === targetPanelId && candidateSessionId === targetSessionId;
	}) || null;
	const leafTextNodes = () => targetPanelRoot
		? Array.from(targetPanelRoot.querySelectorAll("*")).filter((node) => node.children.length === 0)
		: [];
  const hasVisibleLeafContaining = (needle) => leafTextNodes().some((node) => isVisible(node) && text(node).includes(needle));
  const countVisibleLeavesContaining = (needle) => leafTextNodes().filter((node) => isVisible(node) && text(node).includes(needle)).length;
	const visibleTranscriptViewports = () => targetPanelRoot
		? Array.from(targetPanelRoot.querySelectorAll("[data-testid='rust-transcript-viewport']")).filter(isVisible)
		: [];
  const countVisibleTranscriptsContaining = (needle) => visibleTranscriptViewports().filter((node) => text(node).includes(needle)).length;
  const transcriptViewports = visibleTranscriptViewports();
  const transcriptViewportContainingPrompt = transcriptViewports.find((node) => text(node).includes(probePrompt)) || null;
  const firstVisibleTranscriptViewport = transcriptViewportContainingPrompt || transcriptViewports[0] || null;
  const scrollEl = firstVisibleTranscriptViewport ? (firstVisibleTranscriptViewport.querySelector("[role='log']") || firstVisibleTranscriptViewport) : null;
  const scrollRect = scrollEl ? scrollEl.getBoundingClientRect() : null;
  const rows = firstVisibleTranscriptViewport ? Array.from(firstVisibleTranscriptViewport.querySelectorAll("[data-row-id]")) : [];
  const rowIntersectsViewport = (row) => {
    if (!scrollRect) return false;
    const rect = row.getBoundingClientRect();
    return rect.bottom > scrollRect.top && rect.top < scrollRect.bottom;
  };
  const onscreenRows = rows.filter(rowIntersectsViewport);
  const onscreenRowHeights = onscreenRows.map((row) => row.getBoundingClientRect().height);
  let maxOnscreenRowHeightPx = 0;
  for (const height of onscreenRowHeights) {
    maxOnscreenRowHeightPx = Math.max(maxOnscreenRowHeightPx, Math.round(height));
  }
  const placeholder = firstVisibleTranscriptViewport ? firstVisibleTranscriptViewport.querySelector("[data-row-id='awaiting:planning'], [data-row-id='local:planning']") : null;
  const placeholderHeightPx = placeholder ? Math.round(placeholder.getBoundingClientRect().height) : null;
	const placeholderText = placeholder ? text(placeholder) : null;
	const panelRoot = targetPanelRoot ? targetPanelRoot.querySelector("[data-session-id]") : null;
	const sessionId = targetPanelRoot
		? targetPanelRoot.getAttribute("data-qa-agent-panel-session-id") || panelRoot?.getAttribute("data-session-id") || null
		: null;
	const planningSnapshots = typeof window.__acepePlanningSnapshot === "function"
		? window.__acepePlanningSnapshot(sessionId)
		: [];
	const planningSnapshot = planningSnapshots[0] || null;
	const panelId = targetPanelRoot ? targetPanelRoot.getAttribute("data-qa-agent-panel-id") : null;
	const scrollTopPx = scrollEl ? Math.round(scrollEl.scrollTop) : 0;
	const maxScrollTopPx = scrollEl ? Math.max(0, Math.round(scrollEl.scrollHeight - scrollEl.clientHeight)) : 0;
	const distFromBottomPx = scrollEl ? Math.max(0, maxScrollTopPx - scrollTopPx) : 0;
	const scrollAttached = scrollEl ? distFromBottomPx <= 24 : false;
	const scrollReleased = scrollEl ? !scrollAttached : false;
  const sentRowVisibleInViewport = rows.some((row) => text(row).includes(probePrompt) && rowIntersectsViewport(row));
	const visibleComposers = targetPanelRoot
		? Array.from(targetPanelRoot.querySelectorAll("[contenteditable=true], textarea")).filter(isVisible)
		: [];
  const composerText = visibleComposers.map((node) => text(node)).find((value) => value.includes(probePrompt)) || "";
	const bodyText = text(targetPanelRoot);
  const matchingTranscriptViewportCount = countVisibleTranscriptsContaining(probePrompt);
  return {
    label: sampleLabel,
    elapsedMs: Math.round(performance.now() - probeState.startedAt),
    composerText,
    composerContainsPrompt: composerText.includes(probePrompt),
    messageVisible: matchingTranscriptViewportCount > 0,
    messageVisibleInTranscript: matchingTranscriptViewportCount > 0,
    sentRowVisibleInViewport,
    planningVisible: hasVisibleLeafContaining("Planning next moves") || bodyText.includes("Planning next moves"),
    readyVisible: hasVisibleLeafContaining("Ready to assist") || bodyText.includes("Ready to assist"),
    matchingTextLeafCount: countVisibleLeavesContaining(probePrompt),
    matchingTranscriptViewportCount,
		transcriptViewportCount: targetPanelRoot
			? targetPanelRoot.querySelectorAll("[data-testid='rust-transcript-viewport']").length
			: 0,
    maxOnscreenRowHeightPx,
    placeholderHeightPx,
	placeholderText,
	panelId,
	sessionId,
	planningSourceKind: planningSnapshot ? planningSnapshot.sourceKind : null,
	planningLifecycleStatus: planningSnapshot ? planningSnapshot.lifecycleStatus : null,
	planningHasLocalPendingSendIntent: planningSnapshot ? planningSnapshot.hasLocalPendingSendIntent : null,
	planningHasTrailingCompletedTool: planningSnapshot ? planningSnapshot.hasTrailingCompletedTool : null,
	planningLocalPlaceholderMode: planningSnapshot ? planningSnapshot.localPlaceholderMode : null,
	scrollTopPx,
	maxScrollTopPx,
	scrollAttached,
	scrollReleased,
    distFromBottomPx,
    bodyPreview: bodyText.slice(0, 500),
  };
`;
}

function firstSendSubmitScript(
	prompt: string,
	selector: string,
	panelId: string,
	sessionId: string,
	preScrollOffsetPx: number | null,
	timeoutMs: number
): string {
	return `
(async () => {
  const prompt = ${escapedJson(prompt)};
  const selector = ${escapedJson(selector)};
  const targetPanelId = ${escapedJson(panelId)};
  const targetSessionId = ${escapedJson(sessionId)};
	const requestedPreScrollOffsetPx = ${preScrollOffsetPx === null ? "null" : preScrollOffsetPx.toString()};
	const preScrollTolerancePx = 24;
  const timeoutMs = ${Math.max(0, timeoutMs).toString()};
  const baseSelector = selector.length > 0 ? selector : "[contenteditable=true], textarea";
  const text = (node) => node ? (node.textContent || "").trim().replace(/\\s+/g, " ") : "";
  const isVisible = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const rankCandidate = (node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + Math.min(rect.width - 1, Math.max(1, rect.width / 2)), rect.top + Math.min(rect.height - 1, Math.max(1, rect.height / 2)));
    return node === hit || node.contains(hit) ? 0 : 1;
  };
	const targetPanelRoot = Array.from(document.querySelectorAll("[data-qa-agent-panel-id]")).find((candidate) => {
		const candidatePanelId = candidate.getAttribute("data-qa-agent-panel-id") || "";
		const candidateSessionId = candidate.getAttribute("data-qa-agent-panel-session-id")
			|| candidate.querySelector("[data-session-id]")?.getAttribute("data-session-id")
			|| "";
		return candidatePanelId === targetPanelId && candidateSessionId === targetSessionId;
	}) || null;
	const candidates = targetPanelRoot
		? Array.from(targetPanelRoot.querySelectorAll(baseSelector)).filter(isVisible).sort((left, right) => rankCandidate(left) - rankCandidate(right))
		: [];
	window.__acepeFirstSendProbe = { startedAt: performance.now(), prompt, panelId: targetPanelId, sessionId: targetSessionId };
	const scrollWrites = [];
	const scrollEvents = [];
	const inputIntents = [];
	const scrollProvenance = {
		installed: false,
		restored: false,
		writes: scrollWrites,
		events: scrollEvents,
	};
	const targetTranscriptViewport = targetPanelRoot
		? Array.from(targetPanelRoot.querySelectorAll("[data-testid='rust-transcript-viewport']")).find(isVisible) || null
		: null;
	const scrollEl = targetTranscriptViewport
		? targetTranscriptViewport.querySelector("[role='log']") || targetTranscriptViewport
		: null;
	const originalInstanceScrollTopDescriptor = scrollEl
		? Object.getOwnPropertyDescriptor(scrollEl, "scrollTop") || null
		: null;
	let scrollTopDescriptorOwner = scrollEl ? Object.getPrototypeOf(scrollEl) : null;
	let nativeScrollTopDescriptor = null;
	while (scrollTopDescriptorOwner && nativeScrollTopDescriptor === null) {
		nativeScrollTopDescriptor = Object.getOwnPropertyDescriptor(scrollTopDescriptorOwner, "scrollTop") || null;
		scrollTopDescriptorOwner = Object.getPrototypeOf(scrollTopDescriptorOwner);
	}
	const elapsedMs = () => Math.round(performance.now() - window.__acepeFirstSendProbe.startedAt);
	const geometry = () => {
		if (!scrollEl) {
			return {
				scrollTopPx: 0,
				scrollHeightPx: 0,
				clientHeightPx: 0,
				maxScrollTopPx: 0,
				distFromBottomPx: 0,
			};
		}
		const scrollTopPx = Math.round(scrollEl.scrollTop);
		const scrollHeightPx = Math.round(scrollEl.scrollHeight);
		const clientHeightPx = Math.round(scrollEl.clientHeight);
		const maxScrollTopPx = Math.max(0, scrollHeightPx - clientHeightPx);
		return {
			scrollTopPx,
			scrollHeightPx,
			clientHeightPx,
			maxScrollTopPx,
			distFromBottomPx: Math.max(0, maxScrollTopPx - scrollTopPx),
		};
	};
	const compactStack = () => String(new Error().stack || "")
		.split("\\n")
		.slice(2, 8)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join(" <- ")
		.slice(0, 800);
	const nearestPrior = (records, atMs) => {
		for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
			const record = records[recordIndex];
			if (record.elapsedMs <= atMs) return record;
		}
		return null;
	};
	const recordInputIntent = (event) => {
		inputIntents.push({ kind: event.type, elapsedMs: elapsedMs() });
	};
	let previousScrollTopPx = geometry().scrollTopPx;
	const recordScrollEvent = (event) => {
		const eventAtMs = elapsedMs();
		const currentGeometry = geometry();
		const nearestSetter = nearestPrior(scrollWrites, eventAtMs);
		const nearestInputIntent = nearestPrior(inputIntents, eventAtMs);
		const nearestSetterDeltaMs = nearestSetter
			? Math.max(0, eventAtMs - nearestSetter.elapsedMs)
			: null;
		const nearestSetterMovedScrollTop = nearestSetter
			? Math.abs(nearestSetter.afterScrollTopPx - nearestSetter.beforeScrollTopPx) > 0.5
			: null;
		const nearestSetterResultMatchesEvent = nearestSetter
			? Math.abs(currentGeometry.scrollTopPx - nearestSetter.afterScrollTopPx) <= 1
			: null;
		const nearestInputIntentDeltaMs = nearestInputIntent
			? Math.max(0, eventAtMs - nearestInputIntent.elapsedMs)
			: null;
		const isTrusted = typeof event.isTrusted === "boolean" ? event.isTrusted : null;
		let provenance = "synthetic-or-unknown";
		if (
			isTrusted !== false
			&& nearestSetterDeltaMs !== null
			&& nearestSetterDeltaMs <= 100
			&& nearestSetterMovedScrollTop === true
			&& nearestSetterResultMatchesEvent === true
		) {
			provenance = "setter";
		} else if (
			isTrusted !== false
			&& nearestInputIntentDeltaMs !== null
			&& nearestInputIntentDeltaMs <= 250
		) {
			provenance = "input-intent";
		} else if (isTrusted === true) {
			provenance = "native-layout-or-anchoring";
		}
		scrollEvents.push({
			elapsedMs: eventAtMs,
			isTrusted,
			scrollTopPx: currentGeometry.scrollTopPx,
			previousScrollTopPx,
			deltaScrollTopPx: currentGeometry.scrollTopPx - previousScrollTopPx,
			scrollHeightPx: currentGeometry.scrollHeightPx,
			clientHeightPx: currentGeometry.clientHeightPx,
			maxScrollTopPx: currentGeometry.maxScrollTopPx,
			distFromBottomPx: currentGeometry.distFromBottomPx,
			nearestSetterAtMs: nearestSetter ? nearestSetter.elapsedMs : null,
			nearestSetterDeltaMs,
			nearestSetterMovedScrollTop,
			nearestSetterResultMatchesEvent,
			nearestInputIntentKind: nearestInputIntent ? nearestInputIntent.kind : null,
			nearestInputIntentAtMs: nearestInputIntent ? nearestInputIntent.elapsedMs : null,
			nearestInputIntentDeltaMs,
			provenance,
		});
		previousScrollTopPx = currentGeometry.scrollTopPx;
	};
	const inputIntentKinds = ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"];
	if (scrollEl) {
		for (const inputIntentKind of inputIntentKinds) {
			scrollEl.addEventListener(inputIntentKind, recordInputIntent, { capture: true, passive: true });
		}
		scrollEl.addEventListener("scroll", recordScrollEvent, { passive: true });
	}
	if (
		scrollEl
		&& nativeScrollTopDescriptor
		&& typeof nativeScrollTopDescriptor.get === "function"
		&& typeof nativeScrollTopDescriptor.set === "function"
		&& Object.isExtensible(scrollEl)
		&& (originalInstanceScrollTopDescriptor === null || originalInstanceScrollTopDescriptor.configurable)
	) {
		Object.defineProperty(scrollEl, "scrollTop", {
			configurable: true,
			enumerable: nativeScrollTopDescriptor.enumerable === true,
			get() {
				return nativeScrollTopDescriptor.get.call(scrollEl);
			},
			set(value) {
				const beforeGeometry = geometry();
				const requestedScrollTopPx = Number(value);
				const write = {
					elapsedMs: elapsedMs(),
					requestedScrollTopPx: Number.isFinite(requestedScrollTopPx) ? requestedScrollTopPx : 0,
					beforeScrollTopPx: beforeGeometry.scrollTopPx,
					afterScrollTopPx: beforeGeometry.scrollTopPx,
					scrollHeightPx: beforeGeometry.scrollHeightPx,
					clientHeightPx: beforeGeometry.clientHeightPx,
					maxScrollTopPx: beforeGeometry.maxScrollTopPx,
					distFromBottomPx: beforeGeometry.distFromBottomPx,
					stack: compactStack(),
				};
				scrollWrites.push(write);
				nativeScrollTopDescriptor.set.call(scrollEl, value);
				const afterGeometry = geometry();
				write.afterScrollTopPx = afterGeometry.scrollTopPx;
				write.scrollHeightPx = afterGeometry.scrollHeightPx;
				write.clientHeightPx = afterGeometry.clientHeightPx;
				write.maxScrollTopPx = afterGeometry.maxScrollTopPx;
				write.distFromBottomPx = afterGeometry.distFromBottomPx;
			},
		});
		scrollProvenance.installed = true;
	}
	try {
  const samples = [];
  const sample = (label) => {
    samples.push((() => {
${firstSendSharedSamplerScript("prompt", "label", escapedJson(panelId), escapedJson(sessionId))}
    })());
  };
  sample("before-input");
	const preScroll = {
		requestedOffsetPx: requestedPreScrollOffsetPx,
		attempted: false,
		passed: requestedPreScrollOffsetPx === null,
		tolerancePx: preScrollTolerancePx,
		scrollTopPx: null,
		maxScrollTopPx: null,
		distFromBottomPx: null,
	};
	if (requestedPreScrollOffsetPx !== null) {
		preScroll.attempted = true;
		if (scrollEl) {
			scrollEl.dispatchEvent(new WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: -requestedPreScrollOffsetPx,
			}));
			const beforePreScrollGeometry = geometry();
			scrollEl.scrollTop = Math.max(0, beforePreScrollGeometry.maxScrollTopPx - requestedPreScrollOffsetPx);
			scrollEl.dispatchEvent(new Event("scroll", { bubbles: false }));
			await Promise.resolve();
			await new Promise((resolve) => {
				if (typeof requestAnimationFrame === "function") {
					requestAnimationFrame(() => resolve());
					return;
				}
				setTimeout(resolve, 16);
			});
			await Promise.resolve();
			const afterPreScrollGeometry = geometry();
			preScroll.scrollTopPx = afterPreScrollGeometry.scrollTopPx;
			preScroll.maxScrollTopPx = afterPreScrollGeometry.maxScrollTopPx;
			preScroll.distFromBottomPx = afterPreScrollGeometry.distFromBottomPx;
			preScroll.passed = afterPreScrollGeometry.distFromBottomPx >= Math.max(0, requestedPreScrollOffsetPx - preScrollTolerancePx);
		}
		sample("after-pre-scroll");
		if (!preScroll.passed) {
			return {
				composerFound: candidates.length > 0,
				selectedComposerIndex: null,
				selectedComposerName: null,
				sendFound: false,
				sendReadyBeforeClick: false,
				sent: false,
				prompt,
				samples,
				preScroll,
				scrollProvenance,
			};
		}
	}
  if (candidates.length === 0) {
    return {
      composerFound: false,
      selectedComposerIndex: null,
      selectedComposerName: null,
      sendFound: false,
      sendReadyBeforeClick: false,
      sent: false,
	      prompt,
	      samples,
	      preScroll,
	      scrollProvenance,
	    };
  }
  const clearComposer = (target) => {
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      target.value = "";
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: "" }));
      return;
    }
    target.textContent = "";
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: "" }));
  };
  const applyPrompt = (target) => {
    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      target.value = prompt;
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
      return;
    }
    const selection = getSelection();
    if (selection) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.addRange(range);
    }
    if (typeof DataTransfer === "function" && typeof ClipboardEvent === "function") {
      const data = new DataTransfer();
      data.setData("text/plain", prompt);
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: data });
      target.dispatchEvent(paste);
    } else {
      target.textContent = prompt;
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    }
  };
  const findSendForComposer = (target) => {
    let node = target;
    for (let i = 0; i < 10 && node; i += 1) {
      node = node.parentElement;
      if (!node) break;
      const buttons = Array.from(node.querySelectorAll("button")).filter(isVisible);
      const sendByName = buttons.filter((button) => (button.getAttribute("aria-label") || text(button)).trim() === "Send message");
      const candidate = sendByName.find((button) => !button.disabled)
        || sendByName[0]
        || buttons.find((button) => button.classList.contains("bg-foreground") && button.classList.contains("text-background") && !button.disabled)
        || buttons.find((button) => button.classList.contains("bg-foreground") && button.classList.contains("text-background"))
        || null;
      if (candidate) return candidate;
    }
    return null;
  };

  let composer = null;
  let composerIndex = null;
  let send = null;
  let fallbackComposer = candidates[0] || null;
  let fallbackComposerIndex = fallbackComposer ? candidates.indexOf(fallbackComposer) : null;
  let fallbackSend = null;
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    applyPrompt(candidate);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const candidateSend = findSendForComposer(candidate);
    if (candidateSend && !candidateSend.disabled) {
      composer = candidate;
      composerIndex = candidateIndex;
      send = candidateSend;
      break;
    }
    if (fallbackSend === null && candidateSend !== null) {
      fallbackComposer = candidate;
      fallbackComposerIndex = candidateIndex;
      fallbackSend = candidateSend;
    }
    clearComposer(candidate);
    await Promise.resolve();
  }
  if (composer === null) {
    composer = fallbackComposer;
    composerIndex = fallbackComposerIndex;
    send = fallbackSend ?? (composer ? findSendForComposer(composer) : null);
    if (composer !== null && !text(composer).includes(prompt)) {
      applyPrompt(composer);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const composerName = composer ? (composer.getAttribute("aria-label") || composer.getAttribute("placeholder") || "") : null;
  sample("after-input");
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 100));
  sample("after-input-microtask");
  const sendReadyBeforeClick = Boolean(send) && !send.disabled;
  let sent = false;
  if (sendReadyBeforeClick) {
    send.click();
    sent = true;
  }
  sample("after-click");
  await Promise.resolve();
  sample("after-click-microtask");
	const earlyDelays = [10, 40, 50, 150, 250, 500];
	for (const delay of earlyDelays) {
		await new Promise((resolve) => setTimeout(resolve, delay));
		sample("after-" + Math.round(performance.now() - window.__acepeFirstSendProbe.startedAt).toString() + "ms");
	}
	while ((performance.now() - window.__acepeFirstSendProbe.startedAt) < timeoutMs) {
		await new Promise((resolve) => setTimeout(resolve, 500));
		sample("after-" + Math.round(performance.now() - window.__acepeFirstSendProbe.startedAt).toString() + "ms");
	}
  return {
    composerFound: true,
    selectedComposerIndex: composerIndex,
    selectedComposerName: composerName,
    sendFound: Boolean(send),
    sendReadyBeforeClick,
    sent,
	    prompt,
	    samples,
	    preScroll,
	    scrollProvenance,
	  };
	} finally {
		if (scrollEl) {
			for (const inputIntentKind of inputIntentKinds) {
				scrollEl.removeEventListener(inputIntentKind, recordInputIntent, true);
			}
			scrollEl.removeEventListener("scroll", recordScrollEvent);
		}
		if (scrollEl && scrollProvenance.installed) {
			if (originalInstanceScrollTopDescriptor) {
				Object.defineProperty(scrollEl, "scrollTop", originalInstanceScrollTopDescriptor);
				scrollProvenance.restored = true;
			} else {
				scrollProvenance.restored = delete scrollEl.scrollTop;
			}
		} else {
			scrollProvenance.restored = true;
		}
	}
})()
`;
}

// Poll for a node whose text contains `text` and report whether it is actually
// VISIBLE (laid out, not display:none / visibility:hidden / opacity 0) — not
// merely present in the DOM. Returns visibility diagnostics when present-but-hidden.
export function watchForVisibleText(
	options: DriverOptions & {
		readonly text: string;
		readonly timeoutMs: number;
	}
): ResultAsync<WatchResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const needle = ${escapedJson(options.text)};
  const timeoutMs = ${options.timeoutMs.toString()};
  const t0 = performance.now();
  let presentInDom = false, visible = false, firstVisibleAtMs = null, matched = null;
  const isVisible = (n) => {
    const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
    return Boolean(n.offsetParent !== null || cs.position === "fixed") && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0;
  };
  while (performance.now() - t0 < timeoutMs) {
    const nodes = Array.from(document.querySelectorAll("*")).filter((n) => n.children.length === 0 && (n.textContent || "").includes(needle));
    if (nodes.length > 0) {
      presentInDom = true;
      const vis = nodes.find(isVisible) || null;
      const node = vis || nodes[0];
      const cs = getComputedStyle(node); const r = node.getBoundingClientRect();
      matched = { rect: { x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,right:r.right,bottom:r.bottom,left:r.left }, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, hasOffsetParent: node.offsetParent !== null };
      if (vis) { visible = true; firstVisibleAtMs = Math.round(performance.now() - t0); break; }
    }
    await sleep(50);
  }
  return { text: needle, presentInDom, visible, firstVisibleAtMs, elapsedMs: Math.round(performance.now() - t0), timedOut: !visible, matched };
})()
`;
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script,
				schema: watchResultSchema,
				callTimeoutMs: options.timeoutMs + 5_000,
			},
			runner
		);
	});
}
