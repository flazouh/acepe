/**
 * Frontend analytics: Sentry (errors only).
 * Skips in dev unless VITE_FORCE_ANALYTICS=1.
 * Respects preferences:analytics-opt-out in localStorage.
 */

import * as Sentry from "@sentry/svelte";
import { ResultAsync } from "neverthrow";

import { Commands, invoke } from "./utils/tauri-commands.js";

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

	// Set distinct ID for Sentry user context
	void ResultAsync.fromPromise(
		invoke<string>(ANALYTICS_DISTINCT_ID_COMMAND),
		(error) => new Error(`Failed to load analytics distinct ID: ${String(error)}`)
	).match(
		(distinctId) => {
			Sentry.setUser({ id: distinctId });
		},
		(error) => {
			console.warn("Analytics distinct ID unavailable", error);
		}
	);
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
