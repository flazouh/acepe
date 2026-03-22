/**
 * Frontend analytics: Mixpanel (product events) + Sentry (errors only).
 * Skips in dev unless VITE_FORCE_ANALYTICS=1.
 * Respects preferences:analytics-opt-out in localStorage.
 */

import { AnalyticsEvent } from "@acepe/analytics";
import * as Sentry from "@sentry/svelte";
import mixpanel from "mixpanel-browser";
import { ResultAsync } from "neverthrow";

import { Commands, invoke } from "./utils/tauri-commands.js";

export { AnalyticsEvent };

const OPT_OUT_KEY = "preferences:analytics-opt-out";
const ANALYTICS_DISTINCT_ID_COMMAND = Commands.storage.get_analytics_distinct_id;

function isOptedOut(): boolean {
	if (typeof window === "undefined") return true;
	return localStorage.getItem(OPT_OUT_KEY) === "true";
}

function isEnabled(): boolean {
	if (typeof window === "undefined") return false;
	const force = import.meta.env.VITE_FORCE_ANALYTICS === "1";
	if (import.meta.env.DEV && !force) return false;
	return true;
}

function shouldCapture(): boolean {
	return isEnabled() && !isOptedOut();
}

export function initAnalytics(): void {
	// Sentry: errors and replays only
	const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
	if (dsn && dsn.length > 0 && isEnabled()) {
		Sentry.init({
			dsn,
			environment: import.meta.env.MODE,
			enabled: true,
			integrations: [
				Sentry.browserTracingIntegration(),
				Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
			],
			tracesSampleRate: 0.1,
			replaysSessionSampleRate: 0.1,
			replaysOnErrorSampleRate: 1.0,
			ignoreErrors: [/ResizeObserver/],
			beforeSend(event) {
				if (isOptedOut()) return null;
				if (event.exception?.values) {
					for (const exception of event.exception.values) {
						if (exception.stacktrace?.frames) {
							for (const frame of exception.stacktrace.frames) {
								if (frame.filename) {
									frame.filename = frame.filename.replace(
										/\/Users\/[^/]+\//g,
										"/Users/***/"
									);
								}
							}
						}
					}
				}
				return event;
			},
			beforeSendTransaction(event) {
				if (isOptedOut()) return null;
				return event;
			},
		});
	}

	// Mixpanel: product events
	const mixpanelToken = import.meta.env.VITE_MIXPANEL_TOKEN as string | undefined;
	if (mixpanelToken && mixpanelToken.length > 0 && shouldCapture()) {
		mixpanel.init(mixpanelToken, {
			// Desktop uses an app-level opt-out flag instead of inheriting browser DNT from the webview.
			ignore_dnt: true,
			track_pageview: false,
			persistence: "localStorage",
			ip: false,
		});
		mixpanel.register({ source: "desktop" });
	}

	// Set distinct ID for both (Sentry user context, Mixpanel identify)
	void ResultAsync.fromPromise(
		invoke<string>(ANALYTICS_DISTINCT_ID_COMMAND),
		(error) => new Error(`Failed to load analytics distinct ID: ${String(error)}`)
	).match(
		(distinctId) => {
			Sentry.setUser({ id: distinctId });
			if (mixpanelToken && mixpanelToken.length > 0) {
				mixpanel.identify(distinctId);
				mixpanel.register({ source: "desktop", distinct_id: distinctId });
			}
		},
		(error) => {
			console.warn("Analytics distinct ID unavailable", error);
		}
	);
}

/** Track a product event. Sent to Mixpanel only (no-op if Mixpanel token not set). */
export function capture(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
	if (!shouldCapture()) return;
	const token = import.meta.env.VITE_MIXPANEL_TOKEN as string | undefined;
	if (!token || token.length === 0) return;
	mixpanel.track(event, { ...properties, source: "desktop" });
}

/** Set Sentry scope tags for the active agent/session. Call when a session becomes active. */
export function setSentryAgentContext(agentId: string, sessionId?: string): void {
	Sentry.setTag("agent_id", agentId);
	if (sessionId) {
		Sentry.setTag("session_id", sessionId);
	}
}

/** Clear agent context from Sentry scope (e.g. when no session is active). */
export function clearSentryAgentContext(): void {
	Sentry.setTag("agent_id", undefined);
	Sentry.setTag("session_id", undefined);
}

/** Capture an error with full stack trace. Sent to Sentry only. */
export function captureError(error: Error): void {
	if (!isEnabled() || isOptedOut()) return;
	Sentry.captureException(error);
}
