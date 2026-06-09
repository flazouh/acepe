import { err, okAsync, ResultAsync } from "neverthrow";
import type {
	ClickResult,
	DomInspectionResult,
	ResetOnboardingResult,
	SendComposerResult,
	WatchResult,
} from "./schemas";
import {
	clickResultSchema,
	domInspectionResultSchema,
	resetOnboardingResultSchema,
	sendComposerResultSchema,
	watchResultSchema,
} from "./schemas";
import {
	executeWebviewJson,
	runCommand,
	startDriverSession,
	type CommandRunner,
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
		return okAsync(null);
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
  src: node instanceof HTMLImageElement ? node.getAttribute("src") : null,
  classes: typeof node.className === "string" ? node.className : "",
  visible: getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden",
  computedStyle: {
    display: getComputedStyle(node).display,
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

export function clickWebview(
	options: DriverOptions & {
		readonly selector: string | null;
		readonly text: string | null;
	}
): ResultAsync<ClickResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(() => {
  ${ELEMENT_SUMMARY_HELPERS}
  const selector = ${escapedJson(options.selector ?? "")};
  const text = ${escapedJson(options.text ?? "")};
  const candidates = selector.length > 0
    ? Array.from(document.querySelectorAll(selector))
    : Array.from(document.querySelectorAll("button, [role=button], [role=menuitem], a, input, textarea, [contenteditable=true]"));
  const match = candidates.find((node) => {
    if (text.length === 0) return true;
    const label = node.getAttribute("aria-label") || "";
    return label.includes(text) || qaText(node).includes(text);
  }) || null;
  if (match) match.click();
  return {
    clicked: Boolean(match),
    match: match ? qaSummary(match, 0) : null,
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

// Type a prompt into the agent-panel composer (contenteditable, so real input
// events are dispatched, not synthetic keystrokes) and optionally click send.
export function sendComposer(
	options: DriverOptions & {
		readonly text: string;
		readonly submit: boolean;
	}
): ResultAsync<SendComposerResult, TauriMcpFailure> {
	const runner = options.runner ?? runCommand;
	return driverReady(options).andThen(() => {
		const script = `
(() => {
  const text = ${escapedJson(options.text)};
  const submit = ${options.submit ? "true" : "false"};
  const ce = document.querySelector("[contenteditable=true]");
  if (!ce) return { composerFound: false, textApplied: "", sendReady: false, sent: false };
  ce.focus();
  const sel = getSelection(); sel.removeAllRanges();
  const range = document.createRange(); range.selectNodeContents(ce); range.collapse(false); sel.addRange(range);
  ce.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
  document.execCommand("insertText", false, text);
  ce.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  let send = null, node = ce;
  for (let i = 0; i < 8 && node; i++) { node = node.parentElement; if (!node) break; const b = node.querySelector("button.bg-foreground.text-background"); if (b) { send = b; break; } }
  const sendReady = Boolean(send) && !send.disabled;
  let sent = false;
  if (submit && sendReady) { send.click(); sent = true; }
  return { composerFound: true, textApplied: ce.textContent || "", sendReady, sent };
})()
`;
		return executeWebviewJson(
			{ appIdentifier: options.appIdentifier, script, schema: sendComposerResultSchema },
			runner
		);
	});
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
