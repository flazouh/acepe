import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import {
	clickWebview,
	inspectDom,
	navigateWebview,
	openStreamingReproLab,
	probeComputerUse,
	reloadWebview,
	resetOnboarding,
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

	it("reloads the current WebView route", async () => {
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			expect(joined).toContain("window.location.reload()");
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
				joined.includes("getCurrentWindow") && joined.includes("setFocus") && joined.includes("150");
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
						payloadJson: "{\"ok\":true,\"epoch\":\"s_0\",\"elements\":[]}",
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
	});
});
