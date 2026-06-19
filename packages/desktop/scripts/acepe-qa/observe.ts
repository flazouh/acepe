import { ResultAsync, err, ok, okAsync } from "neverthrow";
import type { AppObservation, ObserveLevel, ScreenshotResult } from "./schemas";
import { appObservationSchema, screenshotResultSchema } from "./schemas";
import {
	captureWebviewScreenshot,
	executeWebviewJson,
	runCommand,
	startDriverSession,
	type CommandRunner,
	type TauriMcpFailure,
} from "./tauri-mcp";

const OBSERVE_SCRIPT = `
(() => {
  const text = (node) => node ? (node.textContent || "").trim().replace(/\\s+/g, " ") : "";
  const explicitPanels = Array.from(document.querySelectorAll("[data-testid='agent-panel'], [data-agent-panel], [data-panel-id]"));
  const transcriptViewports = Array.from(document.querySelectorAll("[data-testid='rust-transcript-viewport']"));
  const panels = explicitPanels.length > 0 ? explicitPanels : transcriptViewports;
  const active = document.activeElement;
  const titleNodes = Array.from(document.querySelectorAll(".agent-panel-header-title"));
  const composer = document.querySelector("[contenteditable='true'], textarea, input[type='text']");
  const sendButton = (() => {
    if (!composer) return null;
    let node = composer;
    while (node) {
      node = node.parentElement;
      if (!node) break;
      const match = node.querySelector("button.rounded-full.bg-foreground.text-background, button[aria-label='Send message']");
      if (match) return match;
    }
    return document.querySelector("[data-testid='send-button'], button[aria-label*='Send'], button[type='submit']");
  })();
  const errors = Array.from(document.querySelectorAll("[role='alert'], [data-testid*='error'], .error"))
    .map((node) => text(node))
    .filter((value) => value.length > 0)
    .slice(0, 8);
  const buttons = Array.from(document.querySelectorAll("button, [role='button'], input, textarea, [contenteditable='true']"))
    .slice(0, 30)
    .map((node, index) => ({
      ref: "ref-" + index,
      role: node.getAttribute("role") || node.tagName.toLowerCase(),
      name: node.getAttribute("aria-label") || text(node).slice(0, 80),
      selector: node.id ? "#" + node.id : node.tagName.toLowerCase(),
    }));
  const planningSnapshot = typeof window.__acepePlanningSnapshot === "function"
    ? window.__acepePlanningSnapshot(null)
    : [];
  const readySessions = planningSnapshot.filter((snapshot) => snapshot.sessionCanSubmit === true);
  return {
    url: window.location.href || null,
    title: document.title || null,
    route: window.location.pathname || null,
    panelCount: panels.length,
    focusedPanelTitle: titleNodes.length > 0 ? text(titleNodes[Math.min(titleNodes.length - 1, Math.max(0, panels.length - 1))]) || null : active ? text(active.closest("[data-testid='agent-panel'], [data-agent-panel], [data-panel-id]")) || null : null,
    visibleSessionErrors: errors,
    composer: {
      present: !!composer,
      text: composer ? text(composer) : "",
      sendEnabled: sendButton ? !sendButton.disabled : false,
      sessionCanSubmit: readySessions.length > 0 ? true : planningSnapshot.some((snapshot) => snapshot.sessionId !== null) ? false : null,
    },
    consoleErrors: Array.isArray(window.__ACEPE_QA_CONSOLE_ERRORS__) ? window.__ACEPE_QA_CONSOLE_ERRORS__.slice(-8) : [],
    refs: buttons,
    rawTextPreview: document.body ? text(document.body).slice(0, 1000) : null,
  };
})()
`;

export type ObserveOptions = {
	readonly appIdentifier: string;
	readonly level: ObserveLevel;
	readonly runner?: CommandRunner;
	readonly skipDriver?: boolean;
};

export function observeApp(options: ObserveOptions): ResultAsync<AppObservation, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	const driver =
		options.skipDriver === true
			? okAsync({ code: 0, stdout: "", stderr: "" })
			: startDriverSession(options.appIdentifier, runner);
	return driver.andThen((session) => {
		if (session.code !== 0) {
			return err({
				code: "driver_session_failed",
				message: session.stderr.trim() || session.stdout.trim() || "Unable to start Tauri driver session.",
			});
		}
		return executeWebviewJson(
			{
				appIdentifier: options.appIdentifier,
				script: OBSERVE_SCRIPT,
				schema: appObservationSchema,
				callTimeoutMs: options.level === "raw" ? 30_000 : 15_000,
			},
			runner
		);
	});
}

export function screenshotApp(options: {
	readonly appIdentifier: string;
	readonly runner?: CommandRunner;
	readonly skipDriver?: boolean;
}): ResultAsync<ScreenshotResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	const driver =
		options.skipDriver === true
			? okAsync({ code: 0, stdout: "", stderr: "" })
			: startDriverSession(options.appIdentifier, runner);
	return driver.andThen((session) => {
		if (session.code !== 0) {
			return err({
				code: "driver_session_failed",
				message: session.stderr.trim() || session.stdout.trim() || "Unable to start Tauri driver session.",
			});
		}
		return captureWebviewScreenshot(options.appIdentifier, runner).andThen((path) => {
			const parsed = screenshotResultSchema.safeParse({ path });
			if (!parsed.success) {
				return err({
					code: "screenshot_schema_failed",
					message: parsed.error.message,
				});
			}
			return ok(parsed.data);
		});
	});
}
