import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
	QaClickTarget,
	QaDispatchRequestJson,
	QaInternalBatchJson,
	QaInternalMessageJson,
} from "../host/protocol.ts";
import {
	clickOnPage,
	createTogglePage,
	handleQaMethod,
	QA_PRELOAD_METHODS,
	QA_RESULT_MESSAGE_ID,
	qaDispatchJavascript,
	qaPreloadScript,
	snapshotTextFromPage,
} from "./qa-preload.ts";

describe("qa-preload", () => {
	it.effect("snapshotText walks visible text in tree order", () =>
		Effect.sync(() => {
			const page = createTogglePage();
			expect(snapshotTextFromPage(page)).toBe("Acepe\n  Toggle\n  Closed");
		}),
	);

	it.effect(
		"click by text mutates the page so a later snapshot sees the change",
		() =>
			Effect.sync(() => {
				const page = createTogglePage();
				expect(clickOnPage(page, { text: "Toggle" })).toBe(true);
				expect(snapshotTextFromPage(page)).toBe("Acepe\n  Toggle\n  Opened");
			}),
	);

	it.effect("click by missing text returns false", () =>
		Effect.sync(() => {
			const page = createTogglePage();
			expect(clickOnPage(page, { text: "Missing" })).toBe(false);
			expect(snapshotTextFromPage(page)).toContain("Closed");
		}),
	);

	it.effect("handleQaMethod covers every registered qa handler", () =>
		Effect.sync(() => {
			const page = createTogglePage();
			expect(handleQaMethod(page, "qa:snapshotText", {})).toBe(
				"Acepe\n  Toggle\n  Closed",
			);
			expect(typeof handleQaMethod(page, "qa:snapshotDom", {})).toBe("string");
			expect(handleQaMethod(page, "qa:pageInfo", {})).toEqual({
				title: "Acepe",
				url: "views://mainview/index.html",
			});
			expect(handleQaMethod(page, "qa:click", { text: "Toggle" })).toBe(true);
			expect(handleQaMethod(page, "qa:waitFor", { text: "Opened" })).toBe(true);
			expect(
				handleQaMethod(page, "qa:type", { text: "hello", selector: "#toggle" }),
			).toBe(true);
			expect(handleQaMethod(page, "qa:key", { key: "Enter" })).toBe(true);
			expect(handleQaMethod(page, "qa:scroll", { x: 0, y: 40 })).toBe(true);
			expect(
				handleQaMethod(page, "qa:eval", { source: "document.title" }),
			).toBe("Acepe");
			expect(handleQaMethod(page, "qa:unknown", {})).toBeNull();
		}),
	);

	it.effect(
		"injectable script registers the qa namespace on the internal bridge",
		() =>
			Effect.sync(() => {
				for (const method of QA_PRELOAD_METHODS) {
					expect(qaPreloadScript.includes(method)).toBe(true);
				}
				expect(qaPreloadScript.includes("window.__electrobunQa")).toBe(true);
				expect(qaPreloadScript.includes("__electrobunInternalBridge")).toBe(
					true,
				);
				expect(qaPreloadScript.includes("receiveInternalMessageFromBun")).toBe(
					true,
				);
				expect(qaPreloadScript.includes(QA_RESULT_MESSAGE_ID)).toBe(true);
				expect(qaPreloadScript.includes("requestSubmit")).toBe(true);
			}),
	);

	it.effect("dispatch javascript targets window.__electrobunQa", () =>
		Effect.gen(function* () {
			const encoded = yield* Schema.encodeUnknownEffect(QaDispatchRequestJson)({
				type: "request",
				method: "qa:snapshotText",
				id: "qa-1",
				params: {},
			});
			const js = qaDispatchJavascript(encoded);
			expect(js.startsWith("window.__electrobunQa.dispatch(")).toBe(true);
			expect(js.includes("qa:snapshotText")).toBe(true);
			expect(js.includes("qa-1")).toBe(true);
		}),
	);

	it.effect("preload script answers qa requests over the internal bridge", () =>
		Effect.gen(function* () {
			const posted: Array<string> = [];
			const clicks: Array<string> = [];
			const button = {
				nodeType: 1,
				tagName: "BUTTON",
				hidden: false,
				childNodes: [{ nodeType: 3, textContent: "Toggle" }],
				children: [] as Array<never>,
				textContent: "Toggle",
				getAttribute: () => null,
				querySelectorAll: () => [] as Array<never>,
				click: () => {
					clicks.push("click");
				},
			};
			const body = {
				nodeType: 1,
				tagName: "BODY",
				hidden: false,
				childNodes: [{ nodeType: 3, textContent: "Acepe" }],
				children: [button],
				textContent: "Acepe Toggle",
				getAttribute: () => null,
				querySelectorAll: (selector: string) => {
					if (selector === "*") {
						return [body, button];
					}
					return [];
				},
				querySelector: () => null,
				innerHTML: "<button>Toggle</button>",
			};
			const window = {
				__electrobunInternalBridge: {
					postMessage: (message: string) => {
						posted.push(message);
					},
				},
				__electrobunQa: undefined as
					| { readonly dispatch: (request: unknown) => void }
					| undefined,
				__electrobun: {
					receiveInternalMessageFromBun: () => undefined,
				},
				scrollBy: () => undefined,
				document: {
					body,
					documentElement: body,
					title: "Acepe",
					location: { href: "views://mainview/index.html" },
					querySelector: () => null,
					activeElement: button,
				},
			};
			const run = new Function(
				"window",
				"document",
				`${qaPreloadScript}\nreturn window.__electrobunQa;`,
			);
			const qa = run(window, window.document);
			expect(qa !== null && typeof qa === "object").toBe(true);
			if (qa === null || typeof qa !== "object") {
				return;
			}
			expect("dispatch" in qa).toBe(true);
			if ("dispatch" in qa === false) {
				return;
			}
			const dispatch = qa.dispatch;
			expect(typeof dispatch).toBe("function");
			if (typeof dispatch !== "function") {
				return;
			}
			dispatch({
				type: "request",
				method: "qa:click",
				id: "qa-1",
				params: { text: "Toggle" },
			});
			expect(clicks).toEqual(["click"]);
			expect(posted.length).toBe(1);
			const first = posted[0];
			expect(first !== undefined).toBe(true);
			if (first === undefined) {
				return;
			}
			const batch =
				yield* Schema.decodeUnknownEffect(QaInternalBatchJson)(first);
			const packetLine = batch[0];
			expect(packetLine !== undefined).toBe(true);
			if (packetLine === undefined) {
				return;
			}
			const packet = yield* Schema.decodeUnknownEffect(QaInternalMessageJson)(
				packetLine,
			);
			expect(packet.id).toBe(QA_RESULT_MESSAGE_ID);
			expect(packet.payload.success).toBe(true);
		}),
	);

	it.effect("accepts a click target with only text", () =>
		Effect.sync(() => {
			expect(Schema.is(QaClickTarget)({ text: "Toggle" })).toBe(true);
		}),
	);
});
