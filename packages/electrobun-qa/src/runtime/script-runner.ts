import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"

import { QaEvalFailed, type QaError } from "../errors.ts"
import { type QaSession } from "../host/session.ts"
import { HELPER_NAMES, makeRuntimeHelpers } from "./helpers.ts"

const isQaError = (cause: unknown): cause is QaError =>
	Predicate.isError(cause) === true && "_tag" in cause && typeof cause._tag === "string"

const runHelper = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

export const makePromiseHelpers = (session: QaSession, logs: Array<string>) => {
	const helpers = makeRuntimeHelpers(session, logs)
	return {
		listWindows: () => runHelper(helpers.listWindows()),
		firstWindow: () => runHelper(helpers.firstWindow()),
		useWindow: (windowId: string) => runHelper(helpers.useWindow(windowId)),
		windowInfo: () => runHelper(helpers.windowInfo()),
		snapshotText: () => runHelper(helpers.snapshotText()),
		snapshotDom: () => runHelper(helpers.snapshotDom()),
		pageInfo: () => runHelper(helpers.pageInfo()),
		captureScreenshot: () => runHelper(helpers.captureScreenshot()),
		click: (target: { readonly selector?: string; readonly text?: string }) =>
			runHelper(helpers.click(target)),
		doubleClick: (target: { readonly selector?: string; readonly text?: string }) =>
			runHelper(helpers.doubleClick(target)),
		hover: (target: { readonly selector?: string; readonly text?: string }) =>
			runHelper(helpers.hover(target)),
		typeText: (text: string) => runHelper(helpers.typeText(text)),
		fillInput: (target: { readonly text: string; readonly selector?: string }) =>
			runHelper(helpers.fillInput(target)),
		pressKey: (key: string) => runHelper(helpers.pressKey(key)),
		scrollBy: (x: number, y: number) => runHelper(helpers.scrollBy(x, y)),
		waitForText: (text: string) => runHelper(helpers.waitForText(text)),
		waitForSelector: (selector: string) => runHelper(helpers.waitForSelector(selector)),
		waitForIdle: () => runHelper(helpers.waitForIdle()),
		wait: (ms: number) => runHelper(helpers.wait(ms)),
		js: (source: string) => runHelper(helpers.js(source)),
		queryAll: (selector: string) => runHelper(helpers.queryAll(selector)),
		cliLog: helpers.cliLog,
		help: helpers.help,
	}
}

export type PromiseHelpers = ReturnType<typeof makePromiseHelpers>

export const runUserScript = Effect.fn("runUserScript")(function* (
	source: string,
	session: QaSession,
) {
	const logs: Array<string> = []
	const helpers = makePromiseHelpers(session, logs)
	const values: Array<unknown> = []
	for (const name of HELPER_NAMES) {
		values.push(helpers[name])
	}
	const fn = new Function(
		"listWindows",
		"firstWindow",
		"useWindow",
		"windowInfo",
		"snapshotText",
		"snapshotDom",
		"pageInfo",
		"captureScreenshot",
		"click",
		"doubleClick",
		"hover",
		"typeText",
		"fillInput",
		"pressKey",
		"scrollBy",
		"waitForText",
		"waitForSelector",
		"waitForIdle",
		"wait",
		"js",
		"queryAll",
		"cliLog",
		"help",
		`return (async () => { ${source}\n })()`,
	)
	yield* Effect.tryPromise({
		try: () => fn.apply(undefined, values),
		catch: (cause) => {
			if (isQaError(cause) === true) {
				return cause
			}
			if (Predicate.isError(cause) === true) {
				return new QaEvalFailed({ reason: cause.message })
			}
			return new QaEvalFailed({ reason: String(cause) })
		},
	})
	return logs
})
