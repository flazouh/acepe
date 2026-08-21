import * as Predicate from "effect/Predicate"

import type { ScrollMetrics } from "./follow.ts"

/**
 * User-intent events that may release follow. Generic `scroll` is not one of
 * them; layout-driven scrolls must not strand follow.
 */
export const FOLLOW_RELEASE_INTENT_EVENTS = [
	"wheel",
	"touchstart",
	"touchmove",
	"keydown",
	"pointerdown",
] as const

export const GENERIC_SCROLL_EVENT = "scroll" as const

export type TranscriptViewportEvent =
	| { readonly type: "scroll" }
	| { readonly type: "wheel"; readonly deltaY: number }
	| { readonly type: "touchstart" }
	| { readonly type: "touchmove" }
	| { readonly type: "keydown"; readonly key: string }
	| { readonly type: "pointerdown"; readonly offsetX: number }

export type TranscriptViewportListener = (event: TranscriptViewportEvent) => void

export type TranscriptScrollHost = {
	scrollTop: number
	readonly scrollHeight: number
	readonly clientHeight: number
	readonly clientWidth: number
	addEventListener(
		type: TranscriptViewportEvent["type"],
		listener: TranscriptViewportListener,
		options?: { readonly passive?: boolean },
	): void
	removeEventListener(
		type: TranscriptViewportEvent["type"],
		listener: TranscriptViewportListener,
	): void
}

export type ViewportScheduler = {
	readonly scheduleFrame: (run: () => void) => () => void
	readonly scheduleTimeout: (run: () => void, delayMs: number) => () => void
}

export type DomScrollElement = {
	scrollTop: number
	readonly scrollHeight: number
	readonly clientHeight: number
	readonly clientWidth: number
	addEventListener(
		type: string,
		listener: (event: object) => void,
		options?: { readonly passive?: boolean },
	): void
	removeEventListener(type: string, listener: (event: object) => void): void
}

export type MemoryScrollHost = TranscriptScrollHost & {
	readonly emit: (event: TranscriptViewportEvent) => void
	readonly setScrollHeight: (scrollHeight: number) => void
	readonly setClientHeight: (clientHeight: number) => void
	readonly setClientWidth: (clientWidth: number) => void
}

const numberField = (event: object, field: string): number => {
	if (Predicate.hasProperty(event, field) !== true) {
		return 0
	}
	const value = event[field]
	if (typeof value !== "number") {
		return 0
	}
	return value
}

const stringField = (event: object, field: string): string => {
	if (Predicate.hasProperty(event, field) !== true) {
		return ""
	}
	const value = event[field]
	if (typeof value !== "string") {
		return ""
	}
	return value
}

const fromDomEvent = (
	type: TranscriptViewportEvent["type"],
	event: object,
): TranscriptViewportEvent => {
	switch (type) {
		case "wheel":
			return { type: "wheel", deltaY: numberField(event, "deltaY") }
		case "keydown":
			return { type: "keydown", key: stringField(event, "key") }
		case "pointerdown":
			return { type: "pointerdown", offsetX: numberField(event, "offsetX") }
		case "scroll":
			return { type: "scroll" }
		case "touchstart":
			return { type: "touchstart" }
		case "touchmove":
			return { type: "touchmove" }
	}
}

type DomBinding = {
	readonly type: TranscriptViewportEvent["type"]
	readonly listener: TranscriptViewportListener
	readonly mapped: (event: object) => void
}

export const hostFromElement = (el: DomScrollElement): TranscriptScrollHost => {
	const bindings: Array<DomBinding> = []
	return {
		get scrollTop(): number {
			return el.scrollTop
		},
		set scrollTop(value: number) {
			el.scrollTop = value
		},
		get scrollHeight(): number {
			return el.scrollHeight
		},
		get clientHeight(): number {
			return el.clientHeight
		},
		get clientWidth(): number {
			return el.clientWidth
		},
		addEventListener(type, listener, options) {
			const mapped = (event: object): void => {
				listener(fromDomEvent(type, event))
			}
			bindings.push({ type, listener, mapped })
			el.addEventListener(type, mapped, options)
		},
		removeEventListener(type, listener) {
			let index = 0
			while (index < bindings.length) {
				const binding = bindings[index]
				if (
					binding !== undefined &&
					binding.type === type &&
					binding.listener === listener
				) {
					el.removeEventListener(type, binding.mapped)
					bindings.splice(index, 1)
					return
				}
				index += 1
			}
		},
	}
}

export const createMemoryScrollHost = (input: {
	readonly scrollHeight: number
	readonly clientHeight: number
	readonly clientWidth?: number
	readonly scrollTop?: number
}): MemoryScrollHost => {
	let scrollTop = input.scrollTop === undefined ? 0 : input.scrollTop
	let scrollHeight = input.scrollHeight
	let clientHeight = input.clientHeight
	let clientWidth = input.clientWidth === undefined ? 980 : input.clientWidth
	const listeners = new Map<TranscriptViewportEvent["type"], Set<TranscriptViewportListener>>()

	const listenersFor = (
		type: TranscriptViewportEvent["type"],
	): Set<TranscriptViewportListener> => {
		const existing = listeners.get(type)
		if (existing !== undefined) {
			return existing
		}
		const created = new Set<TranscriptViewportListener>()
		listeners.set(type, created)
		return created
	}

	return {
		get scrollTop(): number {
			return scrollTop
		},
		set scrollTop(value: number) {
			scrollTop = value
		},
		get scrollHeight(): number {
			return scrollHeight
		},
		get clientHeight(): number {
			return clientHeight
		},
		get clientWidth(): number {
			return clientWidth
		},
		addEventListener(type, listener) {
			listenersFor(type).add(listener)
		},
		removeEventListener(type, listener) {
			const set = listeners.get(type)
			if (set !== undefined) {
				set.delete(listener)
			}
		},
		emit(event) {
			const set = listeners.get(event.type)
			if (set === undefined) {
				return
			}
			for (const listener of set) {
				listener(event)
			}
		},
		setScrollHeight(next) {
			scrollHeight = next
		},
		setClientHeight(next) {
			clientHeight = next
		},
		setClientWidth(next) {
			clientWidth = next
		},
	}
}

export const readHostScrollMetrics = (host: TranscriptScrollHost): ScrollMetrics => ({
	scrollTop: host.scrollTop,
	scrollHeight: host.scrollHeight,
	clientHeight: host.clientHeight,
})
