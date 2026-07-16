import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
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
	probeComposerEnterSubmit,
	probeFirstSendTimeline,
	probeFrameRate,
	probeHappyPathPerformance,
	probeLedgerBackfill,
	probePlanningBetweenTools,
	probeSessionOpenContent,
	probeSendAttachStress,
	reloadWebview,
	resetOnboarding,
	scanAgentPanelRows,
	sendComposer,
} from "../interact";
import type { CommandRunner } from "../tauri-mcp";

function wrapped(text: string): string {
	return JSON.stringify({
		content: [
			{
				text,
			},
		],
	});
}

describe("acepe-qa interaction helpers", () => {
	it("inspects DOM elements through the WebView", async () => {
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						selector: ".onboarding-preview-panel",
						count: 3,
						elements: [
							{
								index: 0,
								tag: "div",
								role: null,
								name: "Claude",
								text: "Claude Planning",
								value: null,
								src: null,
								attributes: {},
								classes: "onboarding-preview-panel",
								visible: true,
								focused: false,
								computedStyle: {
									display: "block",
									color: "rgb(113, 113, 122)",
									backgroundColor: "rgba(0, 0, 0, 0)",
									gap: "normal",
									rowGap: "normal",
									columnGap: "normal",
									paddingTop: "4px",
									paddingRight: "4px",
									paddingBottom: "4px",
									paddingLeft: "4px",
									animationName: "none",
									animationDuration: "0s",
									animationDelay: "0s",
									animationIterationCount: "1",
								},
								rect: {
									x: 10,
									y: 20,
									width: 200,
									height: 221,
									top: 20,
									right: 210,
									bottom: 241,
									left: 10,
								},
								animationNames: ["onboarding-preview-stream-reveal"],
							},
						],
					})
				),
				stderr: "",
			});
		};

		const result = await inspectDom({
			appIdentifier: "9223",
			selector: ".onboarding-preview-panel",
			limit: 3,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().count).toBe(3);
		expect(result._unsafeUnwrap().elements[0]?.rect.height).toBe(221);
	});

	it("inspects shadow DOM elements through the WebView", async () => {
		let sawShadowScript = false;
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			sawShadowScript =
				joined.includes("shadowRoot") && joined.includes('[data-testid=\\"git-file-tree\\"]');
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						selector: '[data-testid="git-file-tree"] >>> button[data-type="item"]',
						count: 2,
						elements: [
							{
								index: 0,
								tag: "button",
								role: "treeitem",
								name: "src/main.ts",
								text: "src/main.ts",
								value: null,
								src: null,
								attributes: {
									"data-type": "item",
								},
								classes: "",
								visible: true,
								focused: false,
								computedStyle: {
									display: "flex",
									color: "rgb(113, 113, 122)",
									backgroundColor: "rgba(0, 0, 0, 0)",
									gap: "4px",
									rowGap: "4px",
									columnGap: "4px",
									paddingTop: "0px",
									paddingRight: "0px",
									paddingBottom: "0px",
									paddingLeft: "0px",
									animationName: "none",
									animationDuration: "0s",
									animationDelay: "0s",
									animationIterationCount: "1",
								},
								rect: {
									x: 10,
									y: 20,
									width: 200,
									height: 22,
									top: 20,
									right: 210,
									bottom: 42,
									left: 10,
								},
								animationNames: [],
							},
						],
					})
				),
				stderr: "",
			});
		};

		const result = await inspectShadowDom({
			appIdentifier: "9223",
			hostSelector: '[data-testid="git-file-tree"]',
			selector: 'button[data-type="item"]',
			limit: 3,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().count).toBe(2);
		expect(result._unsafeUnwrap().elements[0]?.role).toBe("treeitem");
		expect(sawShadowScript).toBe(true);
	});

	it("clicks by text and returns the matched element", async () => {
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						clicked: true,
						match: {
							index: 0,
							tag: "button",
							role: null,
							name: "Reset Onboarding",
							text: "Reset Onboarding",
							value: null,
							src: null,
							attributes: {},
							classes: "",
							visible: true,
							focused: false,
							computedStyle: {
								display: "flow-root",
								color: "rgb(113, 113, 122)",
								backgroundColor: "rgba(0, 0, 0, 0)",
								gap: "normal",
								rowGap: "normal",
								columnGap: "normal",
								paddingTop: "0px",
								paddingRight: "0px",
								paddingBottom: "0px",
								paddingLeft: "0px",
								animationName: "none",
								animationDuration: "0s",
								animationDelay: "0s",
								animationIterationCount: "1",
							},
							rect: {
								x: 1,
								y: 2,
								width: 120,
								height: 28,
								top: 2,
								right: 121,
								bottom: 30,
								left: 1,
							},
							animationNames: [],
						},
					})
				),
				stderr: "",
			});
		};

		const result = await clickWebview({
			appIdentifier: "9223",
			selector: null,
			text: "Reset Onboarding",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().clicked).toBe(true);
		expect(result._unsafeUnwrap().match?.text).toBe("Reset Onboarding");
	});

	it("keeps a popover workflow in one WebView script", async () => {
		let executedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({ code: 0, stdout: "", stderr: "" });
			}
			executedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						clicked: true,
						match: null,
					})
				),
				stderr: "",
			});
		};

		const result = await clickWebview({
			appIdentifier: "9223",
			selector: "button[aria-label='Dev Tools']",
			text: null,
			thenSelector: null,
			thenText: "Design System",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(executedScript).toContain("Design System");
		expect(executedScript).toContain("thenText");
	});

	it("moves the native pointer and proves CSS hover before sampling the matched element", async () => {
		let webviewCallCount = 0;
		let movedPoint: { readonly x: number; readonly y: number } | null = null;
		const evaluatedScripts: string[] = [];
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			webviewCallCount += 1;
			evaluatedScripts.push(joined);
			if (webviewCallCount === 1) {
				return okAsync({
					code: 0,
					stdout: wrapped(
						JSON.stringify({
							found: true,
							marker: "acepe-qa-hover-1",
							screenPoint: {
								x: 410,
								y: 260,
							},
						})
					),
					stderr: "",
				});
			}
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						hovered: true,
						matchesHoverPseudoClass: true,
						pointerMoved: true,
						screenPoint: { x: 410, y: 260 },
						match: {
							index: 0,
							tag: "div",
							role: "button",
							name: "Session row",
							text: "Session row",
							value: null,
							src: null,
							attributes: {},
							classes: "",
							visible: true,
							focused: false,
							computedStyle: {
								display: "flow-root",
								color: "rgb(113, 113, 122)",
								backgroundColor: "rgba(0, 0, 0, 0)",
								gap: "normal",
								rowGap: "normal",
								columnGap: "normal",
								paddingTop: "0px",
								paddingRight: "0px",
								paddingBottom: "0px",
								paddingLeft: "0px",
								animationName: "none",
								animationDuration: "0s",
								animationDelay: "0s",
								animationIterationCount: "1",
							},
							rect: {
								x: 1,
								y: 2,
								width: 120,
								height: 28,
								top: 2,
								right: 121,
								bottom: 30,
								left: 1,
							},
							animationNames: [],
						},
					})
				),
				stderr: "",
			});
		};
		const movePointer = (point: { readonly x: number; readonly y: number }) => {
			movedPoint = point;
			return okAsync(null);
		};

		const result = await hoverWebview({
			appIdentifier: "9223",
			selector: null,
			text: "Session row",
			runner,
			movePointer,
			delayMs: 100,
		});

		expect(result.isOk()).toBe(true);
		expect(webviewCallCount).toBe(2);
		expect(movedPoint).toEqual({ x: 410, y: 260 });
		expect(evaluatedScripts[0]).toContain("innerPosition");
		expect(evaluatedScripts[0]).toContain("scaleFactor");
		expect(evaluatedScripts[0]).toContain('invoke("activate_window"');
		expect(evaluatedScripts[1]).toContain('matches(":hover")');
		expect(evaluatedScripts[1]).toContain("await sleep(100)");
		expect(result._unsafeUnwrap().hovered).toBe(true);
		expect(result._unsafeUnwrap().matchesHoverPseudoClass).toBe(true);
		expect(result._unsafeUnwrap().match?.text).toBe("Session row");
	});

	it("navigates the WebView to an app route", async () => {
		let sawScrollReset = false;
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			sawScrollReset = joined.includes("window.scrollTo(0, 0)");
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						from: "http://localhost:1420/",
						to: "http://localhost:1420/test-thinking-block",
						path: "/test-thinking-block",
					})
				),
				stderr: "",
			});
		};

		const result = await navigateWebview({
			appIdentifier: "9223",
			path: "/test-thinking-block",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().path).toBe("/test-thinking-block");
		expect(sawScrollReset).toBe(true);
	});

	it("reloads without awaiting the destroyed document and verifies the reconnected WebView", async () => {
		const webviewCommands: string[] = [];
		let kickoffScript = "";
		let readinessScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			if (command.includes("webview-execute-js-sync")) {
				webviewCommands.push("sync");
				kickoffScript = command[command.indexOf("--script") + 1] ?? "";
				return okAsync({
					code: 0,
					stdout: wrapped(
						JSON.stringify({
							from: "http://localhost:1420/settings",
							to: "http://localhost:1420/settings",
							path: "/settings",
						})
					),
					stderr: "",
				});
			}
			webviewCommands.push("async");
			readinessScript = command[command.indexOf("--script") + 1] ?? "";
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						from: "http://localhost:1420/settings",
						to: "http://localhost:1420/settings",
						path: "/settings",
					})
				),
				stderr: "",
			});
		};

		const result = await reloadWebview({
			appIdentifier: "9223",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().path).toBe("/settings");
		expect(webviewCommands).toEqual(["sync", "async"]);
		expect(kickoffScript).toContain("sessionStorage.setItem");
		expect(kickoffScript).toContain("window.location.reload()");
		expect(readinessScript).toContain("sessionStorage.getItem");
		expect(readinessScript).toContain("window.location.href");
	});

	it("keeps row churn collection out of the frame rate probe unless requested", async () => {
		let sawLightProbe = false;
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			sawLightProbe = joined.includes("const collectRowChurn = false;");
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						route: "/",
						selector: ".message-scroller__viewport",
						selectorMatched: true,
						scrolled: true,
						sampleCount: 2,
						frameDeltasMs: [8, 8],
						averageFrameDeltaMs: 8,
						minFrameDeltaMs: 8,
						maxFrameDeltaMs: 8,
						estimatedFps: 125,
						jankFrameCount: 0,
						visibilityState: "visible",
						documentHasFocus: true,
						requestAnimationFrameAvailable: true,
						rafWaitCount: 3,
						timeoutWaitCount: 0,
						likelyThrottled: false,
						rowChurnSamples: [],
						maxMountedRowCount: null,
						maxUnmountedRowCount: null,
						maxDomRowCount: null,
						agentPanelProfileSamples: [],
						agentPanelProfilePhaseSummaries: [],
					})
				),
				stderr: "",
			});
		};

		const result = await probeFrameRate({
			appIdentifier: "9223",
			sampleCount: 2,
			selector: ".message-scroller__viewport",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(sawLightProbe).toBe(true);
		expect(evaluatedScript).toContain("clearTimeout(timeoutId)");
		expect(evaluatedScript).toContain("const effectiveSampleCount =");
		expect(result._unsafeUnwrap().rowChurnSamples).toHaveLength(0);
	});

	it("enables row churn collection and fixed scroll steps for diagnostic frame rate probes", async () => {
		let sawDiagnosticProbe = false;
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			sawDiagnosticProbe =
				joined.includes("const collectRowChurn = true;") &&
				joined.includes("const scrollStepPx = 425;") &&
				joined.includes("dispatchWheelIntent") &&
				joined.includes("beforeScrollTop - scrollStepPx");
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						route: "/",
						selector: ".message-scroller__viewport",
						selectorMatched: true,
						scrolled: true,
						sampleCount: 1,
						frameDeltasMs: [16],
						averageFrameDeltaMs: 16,
						minFrameDeltaMs: 16,
						maxFrameDeltaMs: 16,
						estimatedFps: 62.5,
						jankFrameCount: 0,
						visibilityState: "visible",
						documentHasFocus: true,
						requestAnimationFrameAvailable: true,
						rafWaitCount: 2,
						timeoutWaitCount: 0,
						likelyThrottled: false,
						rowChurnSamples: [
							{
								frameIndex: 0,
								scrollTopPx: 24,
								domRowCount: 12,
								firstRowIndex: 1,
								lastRowIndex: 12,
								mountedRowCount: 2,
								unmountedRowCount: 1,
							},
						],
						maxMountedRowCount: 2,
						maxUnmountedRowCount: 1,
						maxDomRowCount: 12,
						agentPanelProfileSamples: [],
						agentPanelProfilePhaseSummaries: [],
					})
				),
				stderr: "",
			});
		};

		const result = await probeFrameRate({
			appIdentifier: "9223",
			sampleCount: 1,
			selector: ".message-scroller__viewport",
			collectRowChurn: true,
			scrollStepPx: 425,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(sawDiagnosticProbe).toBe(true);
		expect(result._unsafeUnwrap().maxMountedRowCount).toBe(2);
	});

	it("enables agent panel profile collection for diagnostic frame rate probes", async () => {
		let sawProfileProbe = false;
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			sawProfileProbe =
				joined.includes("const collectAgentPanelProfile = true;") &&
				joined.includes("__acepeEnableAgentPanelPerformanceCapture") &&
				joined.includes("__acepeReadAgentPanelPerformanceCapture");
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						route: "/",
						selector: ".message-scroller__viewport",
						selectorMatched: true,
						scrolled: true,
						sampleCount: 1,
						frameDeltasMs: [16],
						averageFrameDeltaMs: 16,
						minFrameDeltaMs: 16,
						maxFrameDeltaMs: 16,
						estimatedFps: 62.5,
						jankFrameCount: 0,
						visibilityState: "visible",
						documentHasFocus: true,
						requestAnimationFrameAvailable: true,
						rafWaitCount: 2,
						timeoutWaitCount: 0,
						likelyThrottled: false,
						rowChurnSamples: [],
						maxMountedRowCount: null,
						maxUnmountedRowCount: null,
						maxDomRowCount: null,
						agentPanelProfileSamples: [
							{
								phase: "message-scroller.virtual-window",
								durationMs: 1,
								itemCount: 1,
								nodeCount: null,
								timestampMs: 10,
							},
						],
						agentPanelProfilePhaseSummaries: [
							{
								phase: "message-scroller.virtual-window",
								count: 1,
								totalDurationMs: 1,
								averageDurationMs: 1,
								maxDurationMs: 1,
								maxItemCount: 1,
								maxNodeCount: null,
							},
						],
					})
				),
				stderr: "",
			});
		};

		const result = await probeFrameRate({
			appIdentifier: "9223",
			sampleCount: 1,
			selector: ".message-scroller__viewport",
			collectAgentPanelProfile: true,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(sawProfileProbe).toBe(true);
		expect(evaluatedScript.indexOf("__acepeEnableAgentPanelPerformanceCapture")).toBeLessThan(
			evaluatedScript.indexOf("document.querySelectorAll(selector)")
		);
		expect(result._unsafeUnwrap().agentPanelProfileSamples).toHaveLength(1);
	});

	it("scans active agent panel rows for generic Tool labels", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						route: "/",
						selector: '[data-testid="agent-panel-host"] .message-scroller__viewport',
						selectorMatched: true,
						scrollTopPx: 0,
						scrollHeightPx: 2400,
						clientHeightPx: 700,
						maxScrollTopPx: 1700,
						rowCount: 2,
						emptyRowCount: 0,
						exactGenericToolRowCount: 0,
						prefixGenericToolRowCount: 0,
						rawProviderToolRowCount: 0,
						firstRowIndex: 42,
						lastRowIndex: 43,
						rows: [
							{
								index: 0,
								rowId: "row-42",
								rowIndex: 42,
								text: "Executed bun test",
								heightPx: 96,
							},
						],
						genericToolRows: [],
						rawProviderToolRows: [],
					})
				),
				stderr: "",
			});
		};

		const result = await scanAgentPanelRows({
			appIdentifier: "9223",
			selector: '[data-testid="agent-panel-host"] .message-scroller__viewport',
			selectorIndex: 2,
			limit: 10,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().exactGenericToolRowCount).toBe(0);
		expect(result._unsafeUnwrap().rawProviderToolRowCount).toBe(0);
		expect(result._unsafeUnwrap().rowCount).toBe(2);
		expect(evaluatedScript).toContain("[data-row-id]");
		expect(evaluatedScript).toContain("document.querySelectorAll(selector)");
		expect(evaluatedScript).toContain("selectorIndex = 2");
		expect(evaluatedScript).toContain("exactGenericToolRowCount");
		expect(evaluatedScript).toContain("rawProviderToolRowCount");
	});

	it("probes active agent panel scroll paging for blanks and row traversal", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						route: "/",
						selector: '[data-testid="agent-panel-host"] .message-scroller__viewport',
						selectorMatched: true,
						scrollStepPx: 600,
						settleMs: 250,
						sampleCount: 2,
						initialScrollTopPx: 1800,
						finalScrollTopPx: 600,
						initialScrollHeightPx: 2600,
						finalScrollHeightPx: 5200,
						clientHeightPx: 700,
						maxScrollTopPx: 1900,
						reachedTop: false,
						moved: true,
						loadedMoreRows: true,
						distinctRowIdCount: 20,
						distinctFirstRowIdCount: 2,
						maxSampleRowCount: 12,
						zeroRowSampleCount: 0,
						blankViewportSampleCount: 0,
						maxEmptyRowCount: 0,
						maxExactGenericToolRowCount: 0,
						maxPrefixGenericToolRowCount: 0,
						maxRawProviderToolRowCount: 0,
						samples: [
							{
								stepIndex: 0,
								scrollTopPx: 1800,
								scrollHeightPx: 2600,
								clientHeightPx: 700,
								maxScrollTopPx: 1900,
								bufferStartIndex: 6800,
								bufferEndIndex: 7593,
								bufferRowCount: 794,
								bufferTotalRowCount: 7593,
								bufferLastAction: "apply-page",
								bufferLastStatus: "applied",
								bufferLastReason: "older-current",
								rowCount: 12,
								emptyRowCount: 0,
								exactGenericToolRowCount: 0,
								prefixGenericToolRowCount: 0,
								rawProviderToolRowCount: 0,
								firstRowId: "row-tail-1",
								lastRowId: "row-tail-12",
								firstRowText: "Executed bun test",
								lastRowText: "Done",
							},
							{
								stepIndex: 1,
								scrollTopPx: 600,
								scrollHeightPx: 5200,
								clientHeightPx: 700,
								maxScrollTopPx: 4500,
								bufferStartIndex: 6544,
								bufferEndIndex: 7593,
								bufferRowCount: 1050,
								bufferTotalRowCount: 7593,
								bufferLastAction: "apply-page",
								bufferLastStatus: "applied",
								bufferLastReason: "older-current",
								rowCount: 12,
								emptyRowCount: 0,
								exactGenericToolRowCount: 0,
								prefixGenericToolRowCount: 0,
								rawProviderToolRowCount: 0,
								firstRowId: "row-older-1",
								lastRowId: "row-older-12",
								firstRowText: "Older row",
								lastRowText: "Older done",
							},
						],
					})
				),
				stderr: "",
			});
		};

		const result = await probeAgentPanelScrollPages({
			appIdentifier: "9223",
			selector: '[data-testid="agent-panel-host"] .message-scroller__viewport',
			selectorIndex: 2,
			sampleCount: 6,
			scrollStepPx: 600,
			settleMs: 250,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().loadedMoreRows).toBe(true);
		expect(result._unsafeUnwrap().blankViewportSampleCount).toBe(0);
		expect(result._unsafeUnwrap().maxRawProviderToolRowCount).toBe(0);
		expect(result._unsafeUnwrap().samples[0]?.bufferStartIndex).toBe(6800);
		expect(result._unsafeUnwrap().frameDeltasMs).toEqual([]);
		expect(result._unsafeUnwrap().averageFrameDeltaMs).toBeNull();
		expect(result._unsafeUnwrap().missed120FrameCount).toBe(0);
		expect(evaluatedScript).toContain("target.scrollTop = Math.max");
		expect(evaluatedScript).toContain("document.querySelectorAll(selector)");
		expect(evaluatedScript).toContain("selectorIndex = 2");
		expect(evaluatedScript).toContain("distinctRowIds");
		expect(evaluatedScript).toContain("loadedMoreRows");
		expect(evaluatedScript).toContain("waitForNextFrame");
		expect(evaluatedScript).toContain("scrollTopCorrectionPx");
		expect(evaluatedScript).toContain("data-buffer-start-index");
		expect(evaluatedScript).toContain("bufferLastReason");
		expect(evaluatedScript).toContain("frameDeltasMs");
		expect(evaluatedScript).toContain("rawProviderToolRowCount");
		expect(evaluatedScript).toContain("dispatchWheelIntent");
		expect(evaluatedScript).toContain('target.dispatchEvent(new Event("scroll"))');
	});

	it("focuses the Tauri window before probing native computer use", async () => {
		let sawWindowFocus = false;
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			sawWindowFocus =
				joined.includes("getCurrentWindow") &&
				joined.includes("setFocus") &&
				joined.includes("150");
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						serverName: "acepe_computer",
						toolName: "act",
						sessionId: "qa-native-focus",
						transport: "tauri_command_to_in_process_mcp",
						ok: true,
						isError: false,
						payloadJson: '{"ok":true,"epoch":"s_0","elements":[]}',
						app: "Acepe",
						window: "Acepe",
						elementCount: 1,
						errorCode: null,
						permissionKind: null,
						actionVerb: null,
						actionTargetLabel: null,
						actionTargetId: null,
						actionOk: null,
						actionErrorCode: null,
						actionChangedCount: null,
						actionElementCount: null,
					})
				),
				stderr: "",
			});
		};

		const result = await probeComputerUse({
			appIdentifier: "9223",
			sessionId: "qa-native-focus",
			action: "",
			targetLabel: "",
			text: "",
			key: "",
			dx: null,
			dy: null,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(sawWindowFocus).toBe(true);
	});

	it("activates the dev app through the Tauri window command", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						route: "/test-agent-panel-stress",
						documentVisibilityState: "visible",
						documentHasFocus: true,
						windowVisible: true,
						windowMinimized: false,
						windowFocused: true,
						windowOuterWidth: 1352,
						windowOuterHeight: 848,
						windowStateError: null,
						tauriActivateAttempted: true,
						tauriActivateOk: true,
						tauriActivateError: null,
						windowFocusAttempted: true,
						windowFocusOk: true,
						windowFocusError: null,
						message: "Acepe WebView reports visible and focused.",
					})
				),
				stderr: "",
			});
		};

		const result = await focusDevApp({
			appIdentifier: "9223",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().documentVisibilityState).toBe("visible");
		expect(result._unsafeUnwrap().documentHasFocus).toBe(true);
		expect(evaluatedScript).toContain("activate_window");
		expect(evaluatedScript).toContain("getCurrentWindow");
		expect(evaluatedScript).not.toContain("setAlwaysOnTop");
		expect(evaluatedScript).not.toContain("setVisibleOnAllWorkspaces");
		expect(evaluatedScript).not.toContain("getCurrentWebview");
		expect(evaluatedScript).toContain("currentWindow.show");
		expect(evaluatedScript).not.toContain("currentWindow.unminimize");
		expect(evaluatedScript).toContain("isVisible");
		expect(evaluatedScript).toContain("isMinimized");
		expect(evaluatedScript).toContain("isFocused");
	});

	it("probes happy-path app and panel open-close performance", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						hookAvailable: true,
						route: "/",
						runtimeErrors: [],
						timingEnvironment: {
							visibilityState: "visible",
							documentHasFocus: true,
							requestAnimationFrameAvailable: true,
							frameWaitCount: 2,
							frameFallbackCount: 0,
							likelyThrottled: false,
							label: "visible focus=yes raf=yes frameWaits=2 fallbacks=0 throttled=no",
						},
						navigation: {
							type: "reload",
							startTimeMs: 0,
							domInteractiveMs: 140,
							domContentLoadedMs: 160,
							loadEventEndMs: 180,
							durationMs: 190,
						},
						app: {
							mountStartedAtMs: 50,
							shellReadyAtMs: 90,
							shellReadyDurationMs: 40,
							shellReady: true,
							shellReadyWaitMs: 0,
							initializationCompleteAtMs: 130,
							initializationDurationMs: 80,
							initializationComplete: true,
							initializationWaitMs: 0,
							projectReady: true,
							projectReadyWaitMs: 0,
							projectCountAtPanelCreate: 3,
							startupTrace: [
								{
									name: "initialize",
									startedAtMs: 50,
									completedAtMs: 130,
									durationMs: 80,
									status: "ok",
									errorMessage: null,
								},
							],
							projectLoadTrace: {
								totalMs: 10,
								getProjectCountMs: 2,
								getProjectsMs: 8,
								assignStateMs: 0,
								projectCount: 3,
							},
							tauriInvokeTimings: [
								{
									id: "invoke-1",
									command: "get_projects",
									startedAtMs: 60,
									completedAtMs: 68,
									durationMs: 8,
									status: "ok",
								},
							],
							panelCountBefore: 1,
							panelCountAfter: 1,
							domPanelCountBefore: 1,
							domPanelCountAfter: 1,
						},
						openClose: {
							panelId: "panel-qa",
							projectPath: "/repo",
							panelOpenMarks: {
								"agent-panel-host:props": 6,
								"agent-panel:root-state-end": 9,
							},
							panelFirstMarkMs: 6,
							panelLastMarkMs: 9,
							panelMarkedWorkMs: 3,
							panelPreMarkDelayMs: 6,
							panelDomReadyAfterLastMarkMs: 7,
							composerReadyAfterLastMarkMs: 39,
							panelCreateMs: 2,
							panelDomPresentAfterCreate: false,
							panelDomMutationMs: 11,
							panelDomAfterDomFlushMs: 12,
							panelDomAfterFirstFrameMs: null,
							panelDomReadyMs: 16,
							composerMutationMs: 47,
							composerReadyMs: 32,
							composerReadyAfterCreateMs: 48,
							panelDomNodeCount: 120,
							panelRowNodeCount: 12,
							panelDropdownContentNodeCount: 0,
							resizeObserverConstructCount: 14,
							resizeObserverObserveCount: 14,
							resizeObserverCallbackCount: 3,
							closeCallReturnMs: 4,
							closeMicrotaskMs: 5,
							closeDomGoneAfterMicrotask: false,
							closeFirstFrameMs: 16,
							closeDomGoneAfterFirstFrame: true,
							closeDomGoneMs: 16,
							closeTrace: {
								panelId: "panel-qa",
								kind: "agent",
								captureStateMs: 1,
								suppressionMs: 0,
								clearOpeningSessionMs: 0,
								removePanelMs: 1,
								hotStateCleanupMs: 1,
								fileOwnershipCleanupMs: 0,
								embeddedTerminalCleanupMs: 0,
								focusStateApplyMs: 0,
								persistMs: 1,
								totalMs: 4,
							},
							totalMs: 64,
						},
					})
				),
				stderr: "",
			});
		};

		const result = await probeHappyPathPerformance({
			appIdentifier: "9223",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().openClose.panelOpenMarks["agent-panel-host:props"]).toBe(6);
		expect(result._unsafeUnwrap().timingEnvironment.likelyThrottled).toBe(false);
		expect(result._unsafeUnwrap().openClose.panelMarkedWorkMs).toBe(3);
		expect(result._unsafeUnwrap().openClose.panelDomMutationMs).toBe(11);
		expect(result._unsafeUnwrap().openClose.composerMutationMs).toBe(47);
		expect(result._unsafeUnwrap().openClose.composerReadyMs).toBe(32);
		expect(result._unsafeUnwrap().openClose.composerReadyAfterCreateMs).toBe(48);
		expect(result._unsafeUnwrap().openClose.closeTrace?.totalMs).toBe(4);
		expect(evaluatedScript).toContain("__acepeHappyPathProbe");
		expect(evaluatedScript).toContain("ensureMainRoute");
		expect(evaluatedScript).toContain('new URL("/", window.location.origin)');
		expect(evaluatedScript).toContain("setTimeout(finish, 50)");
	});

	it("probes bounded transcript row ledger backfill through the WebView", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						requestedLimit: 1,
						candidateCount: 1,
						checkedCount: 1,
						rebuiltCount: 1,
						rebuiltFromProviderCount: 1,
						skippedCurrentCount: 0,
						skippedNoJournalCount: 0,
						skippedMissingFactsCount: 0,
						failedCount: 0,
						failedSessionIds: [],
					})
				),
				stderr: "",
			});
		};

		const result = await probeLedgerBackfill({
			appIdentifier: "9223",
			limit: 1,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().rebuiltFromProviderCount).toBe(1);
		expect(evaluatedScript).toContain("warm_recent_transcript_row_ledgers");
		expect(evaluatedScript).toContain("limit: 1");
	});

	it("probes session open to first transcript row timing", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						runId: "session-open-content-test",
						status: "done",
						result: {
							hookAvailable: true,
							sessionId: "session-heavy",
							panelId: "panel-1",
							sessionKnownBeforeOpen: false,
							placeholderRegistered: true,
							closedExistingPanel: true,
							closeAfterRequested: true,
							selectCallMs: 2,
							panelDomReadyMs: 4,
							transcriptViewportReadyMs: 6,
							firstRowDomReadyMs: 41,
							firstRowPaintMs: 49,
							rowCountAtFirstPaint: 18,
							finalRowCount: 18,
							panelStillOpenAtEnd: false,
							panelDomPresentAtEnd: false,
							sessionKnownAtEnd: true,
							sessionHasCanonicalProjectionAtEnd: true,
							sessionCanSendAtEnd: true,
							sessionLifecycleStatusAtEnd: "ready",
							sessionMessageCountAtEnd: 470,
							timedOut: false,
							errorMessage: null,
							runtimeErrors: [],
							tauriInvokeTimings: [
								{
									id: "invoke-1",
									command: "get_session_open_result",
									argsSummary: null,
									startedAtMs: 10,
									completedAtMs: 51,
									durationMs: 41,
									status: "ok",
								},
							],
							pendingTauriInvokes: [],
							openEvents: [
								{
									stage: "request-started",
									source: "session-handler",
									panelId: "panel-1",
									sessionId: "session-heavy",
									elapsedMs: 3,
									canonicalSessionId: null,
									outcome: null,
									message: null,
									hasSessionIdentity: null,
									hasSessionMetadata: null,
									shouldAttemptLocalReattach: false,
									hasInitialViewportEnvelope: null,
								},
								{
									stage: "hydrated",
									source: "session-handler",
									panelId: "panel-1",
									sessionId: "session-heavy",
									elapsedMs: 44,
									canonicalSessionId: "session-heavy",
									outcome: null,
									message: null,
									hasSessionIdentity: null,
									hasSessionMetadata: null,
									shouldAttemptLocalReattach: false,
									hasInitialViewportEnvelope: null,
								},
							],
							hydrationTimings: [],
							panelOpenMarks: {},
							agentPanelPerformanceSamples: [],
						},
					})
				),
				stderr: "",
			});
		};

		const result = await probeSessionOpenContent({
			appIdentifier: "9223",
			sessionId: "session-heavy",
			projectPath: "/Users/alex/Documents/acepe",
			agentId: "codex",
			sourcePath: "/Users/alex/.codex/session.jsonl",
			title: "Heavy session",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().firstRowPaintMs).toBe(49);
		expect(result._unsafeUnwrap().tauriInvokeTimings[0]?.command).toBe("get_session_open_result");
		expect(result._unsafeUnwrap().openEvents.map((event) => event.stage)).toEqual([
			"request-started",
			"hydrated",
		]);
		expect(evaluatedScript).toContain("__acepeSessionOpenContentProbe");
		expect(evaluatedScript).toContain("session-heavy");
		expect(evaluatedScript).toContain("/Users/alex/Documents/acepe");
	});

	it("resets onboarding and returns compact facts", async () => {
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						clickedDevTools: true,
						clickedReset: true,
						hasWelcome: true,
						panelCount: 3,
						animated: [
							{
								className: "onboarding-preview-stream-line",
								animationName: "onboarding-preview-stream-reveal",
							},
						],
					})
				),
				stderr: "",
			});
		};

		const result = await resetOnboarding({
			appIdentifier: "9223",
			delayMs: 300,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().panelCount).toBe(3);
		expect(result._unsafeUnwrap().animated).toEqual([
			{
				className: "onboarding-preview-stream-line",
				animationName: "onboarding-preview-stream-reveal",
			},
		]);
	});

	it("opens the streaming repro lab through the dev QA hook", async () => {
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						hookAvailable: true,
						opened: true,
						labPresent: true,
						phaseLabel: "Core streaming · Step 1 of 4",
						tokenRevealAnimatedCount: 2,
						tokenRevealMode: "smooth",
						performance: {
							presetId: "core-streaming",
							phaseCount: 2,
							totalMs: 12,
							visibilityState: "visible",
							documentHasFocus: true,
							steps: [
								{
									phaseId: "thinking-only",
									label: "Agent is preparing",
									phaseIndex: 0,
									assistantTextLength: 0,
									turnState: "Running",
									domFlushMs: 4,
									rowCount: 1,
									animatedTokenSpans: 0,
									tokenRevealMode: null,
								},
								{
									phaseId: "assistant-part-1",
									label: "First words arrive",
									phaseIndex: 1,
									assistantTextLength: 20,
									turnState: "Running",
									domFlushMs: 8,
									rowCount: 2,
									animatedTokenSpans: 2,
									tokenRevealMode: "smooth",
								},
							],
						},
					})
				),
				stderr: "",
			});
		};

		const result = await openStreamingReproLab({
			appIdentifier: "9223",
			delayMs: 300,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().labPresent).toBe(true);
		expect(result._unsafeUnwrap().tokenRevealAnimatedCount).toBe(2);
		expect(result._unsafeUnwrap().performance?.steps.at(1)?.domFlushMs).toBe(8);
	});

	it("opens the agent panel stress lab and returns scroll metrics", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						runId: "stress-test-run",
						status: "done",
						message: null,
						result: {
							hookAvailable: true,
							opened: true,
							labPresent: true,
							route: "/test-agent-panel-stress",
							preset: "mixed",
							rendererMode: "shell-only",
							rowCount: 5000,
							seed: 7,
							renderSettleMs: 120.5,
							domRowCount: 5000,
							scrollToTopMs: 12,
							scrollToBottomMs: 9,
							frameSampleCount: 45,
							jankFrameCount: 3,
							averageFrameDeltaMs: 18.2,
							maxFrameDeltaMs: 55.1,
							estimatedFps: 54.95,
							frameSamplingLikelyThrottled: false,
							frameEnvironmentLabel: "visible focus=yes raf=46 timeout=0 throttled=no",
							memoryLabel: "unavailable",
							dump: {
								route: "/test-agent-panel-stress",
								preset: "mixed",
								rendererMode: "shell-only",
								rowCount: 5000,
								seed: 7,
								timestampIso: "2026-07-02T00:00:00.000Z",
								metrics: {
									generationMs: 10,
									renderSettleMs: 120.5,
									domRowCount: 5000,
									scrollToTopMs: 12,
									scrollToBottomMs: 9,
									scrollUpdateMeasurements: [
										{
											scrollTopPx: 100,
											updateMs: 2,
											domRowCount: 40,
										},
									],
									frameDeltasMs: [16, 18, 55],
									frameEnvironment: {
										visibilityState: "visible",
										documentHasFocus: true,
										requestAnimationFrameAvailable: true,
										rafWaitCount: 46,
										timeoutWaitCount: 0,
									},
									memory: null,
								},
								summary: {
									generationMsLabel: "10 ms",
									renderSettleMsLabel: "120.5 ms",
									domRowCount: 5000,
									scrollToTopMsLabel: "12 ms",
									scrollToBottomMsLabel: "9 ms",
									scrollUpdateSampleCount: 1,
									averageScrollUpdateMs: 2,
									maxScrollUpdateMs: 2,
									maxScrollUpdateDomRowCount: 40,
									frameSampleCount: 45,
									jankFrameCount: 3,
									averageFrameDeltaMs: 18.2,
									maxFrameDeltaMs: 55.1,
									estimatedFps: 54.95,
									frameSamplingLikelyThrottled: false,
									frameEnvironmentLabel: "visible focus=yes raf=46 timeout=0 throttled=no",
									memoryLabel: "unavailable",
								},
								profileSamples: [
									{
										phase: "scene-content.map-scroller-items",
										durationMs: 4,
										itemCount: 5000,
										nodeCount: null,
										timestampMs: 12,
									},
								],
								profileSummary: {
									sampleCount: 1,
									totalDurationMs: 4,
									phases: [
										{
											phase: "scene-content.map-scroller-items",
											count: 1,
											totalDurationMs: 4,
											maxDurationMs: 4,
											averageDurationMs: 4,
											maxItemCount: 5000,
											maxNodeCount: null,
										},
									],
								},
							},
						},
					})
				),
				stderr: "",
			});
		};

		const result = await openAgentPanelStressLab({
			appIdentifier: "9223",
			rowCount: 5000,
			preset: "mixed",
			rendererMode: "shell-only",
			seed: 7,
			includeStreamingTail: true,
			runScrollSample: true,
			delayMs: 300,
			timeoutMs: 20_000,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().rendererMode).toBe("shell-only");
		expect(result._unsafeUnwrap().domRowCount).toBe(5000);
		expect(result._unsafeUnwrap().jankFrameCount).toBe(3);
		expect(evaluatedScript).toContain("/test-agent-panel-stress");
		expect(evaluatedScript).toContain("const rowCount = 5000");
		expect(evaluatedScript).toContain('const rendererMode = "shell-only"');
		expect(evaluatedScript).toContain("getCurrentWindow");
		expect(evaluatedScript).toContain("setFocus");
	});

	it("runs the provider-free send attach scenario in the stress route", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({ code: 0, stdout: "", stderr: "" });
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						hookAvailable: true,
						opened: true,
						labPresent: true,
						route: "/test-agent-panel-stress",
						requestedRowCount: 120,
						rowCount: 122,
						requestedPreScrollOffsetPx: 2000,
						preconditionPassed: true,
						passed: true,
						maxExtentCollapsePx: 0,
						nativeClampDetected: false,
						stableRowShellPreserved: true,
						samples: [
							{
								label: "after-version-update",
								rowCount: 122,
								stableRowId: "stress:send-attach:row:streaming-assistant",
								stableRowVersion: "stress:send-attach:row:streaming-assistant:v2",
								stableRowContent: "send-attach-stream-version-two",
								stableRowShellPreserved: true,
								scrollHeightPx: 8000,
								clientHeightPx: 800,
								maxScrollTopPx: 7200,
								scrollTopPx: 7200,
								distFromBottomPx: 0,
								geometryReleased: false,
								controllerReleased: false,
								longMarkdownRowId: "stress:text-heavy:61:row:00117",
								longMarkdownHeightPx: 2200,
								longMarkdownNative: true,
								placeholderCount: 0,
								spacerCount: 0,
							},
						],
					})
				),
				stderr: "",
			});
		};

		const result = await probeSendAttachStress({
			appIdentifier: "9223",
			rowCount: 120,
			preScrollOffsetPx: 2000,
			delayMs: 300,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().passed).toBe(true);
		expect(evaluatedScript).toContain("/test-agent-panel-stress");
		expect(evaluatedScript).toContain("runSendAttachScenario");
		expect(evaluatedScript).toContain("rowCount: 120");
		expect(evaluatedScript).toContain("preScrollOffsetPx: 2000");
	});

	it("runs the provider-free planning-between-tools transition in the stress route", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({ code: 0, stdout: "", stderr: "" });
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						hookAvailable: true,
						opened: true,
						labPresent: true,
						route: "/test-agent-panel-stress",
						passed: true,
						restoredCompletedToolStage: true,
						samples: [
							{
								stage: "completed_tool_tail",
								sessionId: "stress-agent-panel-planning-between-tools-session",
								lifecycleStatus: "ready",
								activityKind: "awaiting_model",
								turnState: "Running",
								trailingRowId: "stress:tool-heavy:71:row:00001",
								trailingRowKind: "tool",
								trailingOperationStates: ["completed"],
								activeStreamingTail: null,
								localPlaceholderMode: "planning_after_tool",
								planningRowCount: 1,
								planningText: "Planning next moves",
								planningVisible: true,
							},
							{
								stage: "active_assistant_tail",
								sessionId: "stress-agent-panel-planning-between-tools-session",
								lifecycleStatus: "ready",
								activityKind: "awaiting_model",
								turnState: "Running",
								trailingRowId: "stress:tool-heavy:71:row:00002",
								trailingRowKind: "assistantText",
								trailingOperationStates: [],
								activeStreamingTail: "message",
								localPlaceholderMode: "none",
								planningRowCount: 0,
								planningText: null,
								planningVisible: false,
							},
						],
					})
				),
				stderr: "",
			});
		};

		const result = await probePlanningBetweenTools({
			appIdentifier: "9223",
			delayMs: 300,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().passed).toBe(true);
		expect(evaluatedScript).toContain("/test-agent-panel-stress");
		expect(evaluatedScript).toContain("runPlanningBetweenToolsScenario");
	});

	it("keeps the send prompt separate from DOM text helpers", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						composerFound: true,
						textApplied: "QA prompt",
						sendReady: true,
						sent: true,
					})
				),
				stderr: "",
			});
		};

		const result = await sendComposer({
			appIdentifier: "9223",
			text: "QA prompt",
			submit: true,
			selector: "",
			selectorIndex: 2,
			panelId: "panel-1",
			sessionId: "session-1",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(evaluatedScript).toContain("const promptText =");
		expect(evaluatedScript).toContain("const selectorIndex = 2");
		expect(evaluatedScript).toContain('const panelId = "panel-1"');
		expect(evaluatedScript).toContain('const sessionId = "session-1"');
		expect(evaluatedScript).toContain("[data-qa-agent-panel-id]");
		expect(evaluatedScript).toContain("[data-session-id]");
		expect(evaluatedScript).not.toContain('const text = "QA prompt"');
		expect(evaluatedScript).toContain("button.textContent");
	});

	it("probes plain Enter submission inside the exact historical session panel", async () => {
		let evaluatedScript = "";
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({ code: 0, stdout: "", stderr: "" });
			}
			evaluatedScript = joined;
			return okAsync({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						targetFound: true,
						composerFound: true,
						textApplied: "QA enter prompt",
						sendReadyBeforeEnter: true,
						enterDefaultPrevented: true,
						newlineWouldBeInserted: false,
						draftAfterEnter: "",
						submittedUserRowFound: true,
						planningBefore: null,
						planningAfter: null,
					})
				),
				stderr: "",
			});
		};

		const result = await probeComposerEnterSubmit({
			appIdentifier: "9223",
			text: "QA enter prompt",
			panelId: "panel-f38",
			sessionId: "session-f38",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(evaluatedScript).toContain('const panelId = "panel-f38"');
		expect(evaluatedScript).toContain('const sessionId = "session-f38"');
		expect(evaluatedScript).toContain("new KeyboardEvent");
		expect(evaluatedScript).toContain('key: "Enter"');
		expect(evaluatedScript).toContain("defaultPrevented");
		expect(evaluatedScript).toContain("__acepePlanningSnapshot");
		expect(evaluatedScript).toContain("submittedUserRowFound");
	});

	it("scopes the first-send timeline to one exact panel and session", async () => {
		const evaluatedScripts: string[] = [];
		const sample = {
			label: "after-click",
			elapsedMs: 0,
			composerText: "",
			composerContainsPrompt: false,
			messageVisible: true,
			messageVisibleInTranscript: true,
			sentRowVisibleInViewport: true,
			planningVisible: false,
			readyVisible: false,
			matchingTextLeafCount: 1,
			matchingTranscriptViewportCount: 1,
			transcriptViewportCount: 1,
			maxOnscreenRowHeightPx: 48,
			placeholderHeightPx: null,
			placeholderText: null,
			panelId: "panel-opencode",
			sessionId: "session-opencode",
			planningSourceKind: "canonical",
			planningLifecycleStatus: "ready",
			planningHasLocalPendingSendIntent: false,
			planningHasTrailingCompletedTool: false,
			planningLocalPlaceholderMode: "none",
			scrollTopPx: 1_000,
			maxScrollTopPx: 1_000,
			scrollAttached: true,
			scrollReleased: false,
			distFromBottomPx: 0,
			bodyPreview: "Reply with 1.",
		};
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({ code: 0, stdout: "", stderr: "" });
			}
			evaluatedScripts.push(joined);
			const payload = joined.includes("const baseSelector")
				? {
						composerFound: true,
						selectedComposerIndex: 0,
						selectedComposerName: "Send follow-up",
						sendFound: true,
						sendReadyBeforeClick: true,
						sent: true,
						prompt: "Reply with 1.",
						samples: [sample],
						preScroll: {
							requestedOffsetPx: 2_000,
							attempted: true,
							passed: true,
							tolerancePx: 24,
							scrollTopPx: 8_000,
							maxScrollTopPx: 10_000,
							distFromBottomPx: 2_000,
						},
						scrollProvenance: {
							installed: true,
							restored: true,
							writes: [],
							events: [],
						},
					}
				: sample;
			return okAsync({
				code: 0,
				stdout: wrapped(JSON.stringify(payload)),
				stderr: "",
			});
		};

		const result = await probeFirstSendTimeline({
			appIdentifier: "9223",
			text: "Reply with 1.",
			selector: "",
			panelId: "panel-opencode",
			sessionId: "session-opencode",
			preScrollOffsetPx: 2_000,
			timeoutMs: 0,
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(evaluatedScripts).toHaveLength(1);
		for (const script of evaluatedScripts) {
			expect(script).toContain('const targetPanelId = "panel-opencode"');
			expect(script).toContain('const targetSessionId = "session-opencode"');
			expect(script).toContain("[data-qa-agent-panel-id]");
			expect(script).toContain("targetPanelRoot.querySelectorAll");
			expect(script).toContain('Object.defineProperty(scrollEl, "scrollTop"');
			expect(script).toContain("nativeScrollTopDescriptor.get.call");
			expect(script).toContain("nativeScrollTopDescriptor.set.call");
			expect(script).toContain("new Error().stack");
			expect(script).toContain('scrollEl.addEventListener("scroll"');
			expect(script).toContain("event.isTrusted");
			expect(script).toContain("nearestSetterMovedScrollTop === true");
			expect(script).toContain("nearestSetterResultMatchesEvent === true");
			expect(script).toContain('provenance = "native-layout-or-anchoring"');
			expect(script).toContain("finally");
			expect(script).toContain("originalInstanceScrollTopDescriptor");
			expect(script).toContain("const requestedPreScrollOffsetPx = 2000");
			expect(script).toContain('new WheelEvent("wheel"');
			expect(script).toContain("scrollEl.scrollTop = Math.max");
			expect(script).toContain('scrollEl.dispatchEvent(new Event("scroll"');
			expect(script).toContain("requestAnimationFrame");
			expect(script).toContain("if (!preScroll.passed)");
			expect(script.indexOf("if (!preScroll.passed)")).toBeLessThan(
				script.indexOf("applyPrompt(candidate)")
			);
		}
	});
});
