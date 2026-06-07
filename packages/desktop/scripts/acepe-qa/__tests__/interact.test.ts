import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import { clickWebview, inspectDom, resetOnboarding } from "../interact";
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
								src: null,
								classes: "onboarding-preview-panel",
								visible: true,
								computedStyle: {
									display: "block",
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
							src: null,
							classes: "",
							visible: true,
							computedStyle: {
								display: "flow-root",
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
});
