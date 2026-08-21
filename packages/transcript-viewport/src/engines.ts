/**
 * Three Electrobun webview engines. JS scroll anchoring is retained on every
 * engine because WebKit still has no `overflow-anchor`. Do not switch WebView2
 * onto native anchoring.
 */

export const WEBVIEW_ENGINE_IDS = ["webkit-macos", "webview2-windows", "webkitgtk-linux"] as const
export type WebviewEngineId = (typeof WEBVIEW_ENGINE_IDS)[number]

export type WebviewEngineProfile = {
	readonly id: WebviewEngineId
	readonly nativeOverflowAnchor: boolean
	readonly contentVisibility: boolean
	readonly jsScrollAnchoring: boolean
}

export const WEBVIEW_ENGINES: ReadonlyArray<WebviewEngineProfile> = [
	{
		id: "webkit-macos",
		nativeOverflowAnchor: false,
		contentVisibility: true,
		jsScrollAnchoring: true,
	},
	{
		id: "webview2-windows",
		nativeOverflowAnchor: true,
		contentVisibility: true,
		jsScrollAnchoring: true,
	},
	{
		id: "webkitgtk-linux",
		nativeOverflowAnchor: false,
		contentVisibility: true,
		jsScrollAnchoring: true,
	},
]

/** Always `none`. Native overflow-anchor must not fight JS corrections. */
export const TRANSCRIPT_OVERFLOW_ANCHOR = "none" as const

/** Off-screen rows use estimate→real sizing. That burst must not strand follow. */
export const TRANSCRIPT_CONTENT_VISIBILITY = "auto" as const

export const engineUsesJsScrollAnchoring = (engine: WebviewEngineProfile): boolean =>
	engine.jsScrollAnchoring === true

export const overflowAnchorCssFor = (_engine: WebviewEngineProfile): "none" =>
	TRANSCRIPT_OVERFLOW_ANCHOR
