import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"

import { QaElementNotFound, QaHelperTimeout, QaScreenshotDisabled } from "../errors.ts"
import { DEFAULT_HELPER_DEADLINE } from "../host/bridge-client.ts"
import { type QaQuery } from "../preload/qa-preload.ts"
import { type QaSession } from "../host/session.ts"

export const HELPER_NAMES = [
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
] as const

export type HelperName = (typeof HELPER_NAMES)[number]

export const helperHelp = (name: HelperName): string => {
	if (name === "snapshotText") {
		return "snapshotText({ selector }?): accessibility-shaped text tree of the window or a subtree"
	}
	if (name === "click") {
		return "click({ text } | { selector }): click an element by visible text or CSS selector"
	}
	if (name === "cliLog") {
		return "cliLog(value): the only output path inside a heredoc script"
	}
	if (name === "help") {
		return "help(name): usage for a helper"
	}
	return `${name}(): electrobun-qa helper`
}

export const formatCliValue = (value: unknown): string => {
	if (typeof value === "string") {
		return value
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value)
	}
	if (value === null) {
		return "null"
	}
	if (value === undefined) {
		return "undefined"
	}
	if (Array.isArray(value) === true) {
		return value.map((item) => formatCliValue(item)).join(", ")
	}
	if (typeof value === "object") {
		const keys = Object.keys(value)
		const parts: Array<string> = []
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key)
			const field = descriptor === undefined ? undefined : descriptor.value
			parts.push(`${key}=${formatCliValue(field)}`)
		}
		return parts.join(" ")
	}
	return String(value)
}

const pollUntil = Effect.fn("pollUntil")(function* (
	helper: string,
	probe: Effect.Effect<boolean, never>,
	deadline: Duration.Duration,
) {
	yield* probe.pipe(
		Effect.flatMap((found) =>
			found === true ? Effect.void : Effect.fail(new QaElementNotFound({ query: helper })),
		),
		Effect.retry(Schedule.spaced(Duration.millis(25))),
		Effect.timeoutOrElse({
			duration: deadline,
			orElse: () => Effect.fail(new QaHelperTimeout({ helper })),
		}),
	)
})

export const makeRuntimeHelpers = (session: QaSession, logs: Array<string>) => {
	const snapshotText = Effect.fn("snapshotText")(function* (target?: QaQuery) {
		return yield* session.call("qa:snapshotText", target === undefined ? {} : target)
	})
	const snapshotDom = Effect.fn("snapshotDom")(function* () {
		return yield* session.call("qa:snapshotDom", {})
	})
	const pageInfo = Effect.fn("pageInfo")(function* () {
		return yield* session.call("qa:pageInfo", {})
	})
	const captureScreenshot = Effect.fn("captureScreenshot")(function* () {
		return yield* new QaScreenshotDisabled()
	})
	const click = Effect.fn("click")(function* (target: QaQuery) {
		return yield* session.call("qa:click", target)
	})
	const doubleClick = Effect.fn("doubleClick")(function* (target: QaQuery) {
		yield* click(target)
		return yield* click(target)
	})
	const hover = Effect.fn("hover")(function* (target: QaQuery) {
		return yield* session.call("qa:click", target)
	})
	const typeText = Effect.fn("typeText")(function* (text: string) {
		return yield* session.call("qa:type", { text })
	})
	const fillInput = Effect.fn("fillInput")(function* (target: QaQuery & { readonly text: string }) {
		if (target.selector !== undefined) {
			return yield* session.call("qa:type", {
				text: target.text,
				selector: target.selector,
				replace: true,
			})
		}
		return yield* session.call("qa:type", { text: target.text, replace: true })
	})
	const pressKey = Effect.fn("pressKey")(function* (key: string) {
		return yield* session.call("qa:key", { key })
	})
	const scrollBy = Effect.fn("scrollBy")(function* (x: number, y: number) {
		return yield* session.call("qa:scroll", { x, y })
	})
	const waitForText = Effect.fn("waitForText")(function* (text: string, timeoutMs?: number) {
		return yield* pollUntil(
			"waitForText",
			session.call("qa:waitFor", { text }).pipe(
				Effect.map((found) => found === true),
				Effect.orElseSucceed(() => false),
			),
			timeoutMs === undefined ? DEFAULT_HELPER_DEADLINE : Duration.millis(timeoutMs),
		)
	})
	const waitForSelector = Effect.fn("waitForSelector")(function* (selector: string) {
		return yield* pollUntil(
			"waitForSelector",
			session.call("qa:waitFor", { selector }).pipe(
				Effect.map((found) => found === true),
				Effect.orElseSucceed(() => false),
			),
			DEFAULT_HELPER_DEADLINE,
		)
	})
	const waitForIdle = Effect.fn("waitForIdle")(function* () {
		return yield* pollUntil(
			"waitForIdle",
			Effect.succeed(true),
			DEFAULT_HELPER_DEADLINE,
		)
	})
	const wait = Effect.fn("wait")(function* (ms: number) {
		yield* Effect.sleep(Duration.millis(ms)).pipe(
			Effect.timeoutOrElse({
				duration: DEFAULT_HELPER_DEADLINE,
				orElse: () => Effect.fail(new QaHelperTimeout({ helper: "wait" })),
			}),
		)
	})
	const js = Effect.fn("js")(function* (source: string) {
		return yield* session.call("qa:eval", { source })
	})
	const queryAll = Effect.fn("queryAll")(function* (selector: string) {
		return yield* session.call("qa:eval", { source: selector })
	})
	const listWindows = Effect.fn("listWindows")(function* () {
		return yield* session.listWindows()
	})
	const firstWindow = Effect.fn("firstWindow")(function* () {
		return yield* session.firstWindow()
	})
	const useWindow = Effect.fn("useWindow")(function* (windowId: string) {
		return yield* session.useWindow(windowId)
	})
	const windowInfo = Effect.fn("windowInfo")(function* () {
		return yield* session.windowInfo()
	})
	const cliLog = (value: unknown): void => {
		logs.push(formatCliValue(value))
	}
	const help = (name: HelperName): string => helperHelp(name)
	return {
		listWindows,
		firstWindow,
		useWindow,
		windowInfo,
		snapshotText,
		snapshotDom,
		pageInfo,
		captureScreenshot,
		click,
		doubleClick,
		hover,
		typeText,
		fillInput,
		pressKey,
		scrollBy,
		waitForText,
		waitForSelector,
		waitForIdle,
		wait,
		js,
		queryAll,
		cliLog,
		help,
	}
}

export type RuntimeHelpers = ReturnType<typeof makeRuntimeHelpers>
