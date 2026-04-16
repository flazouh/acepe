import * as Sentry from "@sentry/browser";
import posthog from "posthog-js";
import { ResultAsync } from "neverthrow";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { settings } from "$lib/utils/tauri-client/settings.js";

const ANALYTICS_OPT_OUT_KEY: UserSettingKey = "analytics_opt_out";
const DEVICE_ID_STORAGE_KEY = "analytics_device_id";
const APP_OPENED_EVENT = "app_opened";

/** Telemetry context attached to captured exceptions. */
export interface TelemetryContext {
	source: string;
	[key: string]: string | number | boolean;
}

/** Properties attached to captured events. */
export interface TelemetryEventProperties {
	[key: string]: string | number | boolean;
}

export interface CommandFailureTelemetryContext {
	commandName: string;
	invokeId: string;
	elapsedMs: number;
	classification?: "expected" | "unexpected";
	backendCorrelationId?: string;
	backendEventId?: string;
}

function posthogApiHost(): string {
	const fromEnv: string | undefined = import.meta.env.VITE_POSTHOG_HOST;
	if (fromEnv && fromEnv.length > 0) {
		return fromEnv;
	}
	return "https://eu.i.posthog.com";
}

const logger = createLogger({
	id: "analytics",
	name: "Analytics",
});

let analyticsEnabled = true;
let initPromise: Promise<void> | null = null;
let sentryInitialized = false;
let posthogInitialized = false;
let distinctId: string | null = null;
let appVersion: string | null = null;

function isBrowser(): boolean {
	return typeof window !== "undefined";
}

function normalizeError(error: Error | string | undefined, fallback: string): Error {
	if (error instanceof Error) {
		return error;
	}

	const detail = error === undefined ? "" : `: ${String(error)}`;
	return new Error(`${fallback}${detail}`);
}

function shouldEnableAnalyticsInThisBuild(): boolean {
	return !import.meta.env.DEV || import.meta.env.VITE_FORCE_ANALYTICS === "1";
}

function readDistinctId(): string {
	if (!isBrowser()) {
		return "server";
	}

	if (distinctId !== null) {
		return distinctId;
	}

	try {
		const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
		if (existing && existing.length > 0) {
			distinctId = existing;
			return existing;
		}

		const created = crypto.randomUUID();
		window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
		distinctId = created;
		return created;
	} catch {
		// localStorage unavailable or quota exceeded — use in-memory fallback
		const fallback = crypto.randomUUID();
		distinctId = fallback;
		return fallback;
	}
}

function clearDistinctId(): void {
	distinctId = null;
	try {
		window.localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
	} catch {
		// localStorage unavailable — nothing to clear
	}
}

async function readAppVersion(): Promise<string | null> {
	if (appVersion !== null) {
		return appVersion;
	}

	return ResultAsync.fromPromise(
		import("@tauri-apps/api/app").then((mod) => mod.getVersion()),
		(error) => normalizeError(error instanceof Error ? error : undefined, "Failed to load app version")
	).match(
		(version) => {
			appVersion = version;
			return version;
		},
		(error) => {
			logger.warn("Unable to resolve app version for analytics", { error });
			return null;
		}
	);
}

async function readAnalyticsEnabledPreference(): Promise<boolean> {
	return settings.get<boolean>(ANALYTICS_OPT_OUT_KEY).match(
		(value) => !(value ?? false),
		(error) => {
			logger.warn("Failed to load analytics preference", { error });
			return true;
		}
	);
}

function syncIdentity(): void {
	const id = readDistinctId();

	if (sentryInitialized) {
		Sentry.setUser({ id });
	}

	if (posthogInitialized && analyticsEnabled) {
		posthog.identify(id);
	}
}

async function initializeSentry(version: string | null): Promise<void> {
	if (sentryInitialized) {
		return;
	}

	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!dsn) {
		return;
	}

	await ResultAsync.fromPromise(
		Promise.resolve().then(() => {
			Sentry.init({
				dsn,
				defaultIntegrations: false,
				sendDefaultPii: false,
				tracesSampleRate: 0.1,
				environment: import.meta.env.DEV ? "development" : "production",
				release: version ? `acepe@${version}` : undefined,
				beforeSend: (event) => (analyticsEnabled ? event : null),
			});
		}),
		(error) => normalizeError(error instanceof Error ? error : undefined, "Failed to initialize Sentry")
	).match(
		() => {
			sentryInitialized = true;
			syncIdentity();
		},
		(error) => {
			logger.warn("Sentry initialization failed", { error });
		}
	);
}

async function initializePostHog(version: string | null): Promise<void> {
	if (posthogInitialized) {
		return;
	}

	const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
	if (!posthogKey) {
		return;
	}

	await ResultAsync.fromPromise(
		Promise.resolve().then(() => {
			posthog.init(posthogKey, {
				api_host: posthogApiHost(),
				autocapture: false,
				capture_pageview: false,
				disable_session_recording: true,
				persistence: "localStorage",
				opt_out_capturing_by_default: !analyticsEnabled,
			});
		}),
		(error) => normalizeError(error instanceof Error ? error : undefined, "Failed to initialize PostHog")
	).match(
		() => {
			posthogInitialized = true;
			syncIdentity();
			if (analyticsEnabled) {
				posthog.capture(APP_OPENED_EVENT, version ? { appVersion: version } : {});
			}
		},
		(error) => {
			logger.warn("PostHog initialization failed", { error });
		}
	);
}

async function doInit(): Promise<void> {
	if (!shouldEnableAnalyticsInThisBuild()) {
		logger.info("Analytics disabled in development build");
		return;
	}

	analyticsEnabled = await readAnalyticsEnabledPreference();
	readDistinctId();

	const version = await readAppVersion();
	await initializeSentry(version);
	await initializePostHog(version);
}

export async function initAnalytics(): Promise<void> {
	if (!isBrowser()) {
		return;
	}

	if (initPromise !== null) {
		return initPromise;
	}

	initPromise = doInit().catch((error) => {
		logger.warn("Analytics initialization failed", { error });
		// Allow retry on next call
		initPromise = null;
	});

	return initPromise;
}

export function captureEvent(event: string, properties: TelemetryEventProperties = {}): void {
	if (!analyticsEnabled || !posthogInitialized) {
		return;
	}

	try {
		posthog.capture(event, properties);
	} catch (error) {
		logger.warn("Analytics event capture failed", { event, error });
	}
}

export function captureException(error: Error, context: TelemetryContext = { source: "unknown" }): void {
	if (!analyticsEnabled || !sentryInitialized) {
		return;
	}

	try {
		Sentry.withScope((scope) => {
			for (const [key, value] of Object.entries(context)) {
				scope.setExtra(key, value);
			}
			Sentry.captureException(error);
		});
	} catch (sentryError) {
		logger.warn("Sentry captureException failed", { sentryError });
	}
}

export function captureCommandFailure(
	error: Error,
	context: CommandFailureTelemetryContext
): void {
	if (context.classification === "expected") {
		return;
	}

	const telemetryContext: TelemetryContext = {
		source: "tauri-invoke",
		commandName: context.commandName,
		invokeId: context.invokeId,
		elapsedMs: context.elapsedMs,
		commandClassification: context.classification ?? "unexpected",
		hasBackendCorrelationId: Boolean(context.backendCorrelationId),
		hasBackendEventId: Boolean(context.backendEventId),
	};

	if (context.backendCorrelationId !== undefined) {
		telemetryContext.backendCorrelationId = context.backendCorrelationId;
	}

	if (context.backendEventId !== undefined) {
		telemetryContext.backendEventId = context.backendEventId;
	}

	captureException(error, telemetryContext);
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
	if (!shouldEnableAnalyticsInThisBuild()) {
		analyticsEnabled = enabled;
		return;
	}

	// Ensure init is complete before toggling
	if (initPromise !== null) {
		await initPromise;
	} else {
		await initAnalytics();
	}

	analyticsEnabled = enabled;

	if (!enabled) {
		clearDistinctId();
	}

	if (!posthogInitialized) {
		return;
	}

	await ResultAsync.fromPromise(
		Promise.resolve().then(() => {
			if (enabled) {
				posthog.opt_in_capturing();
				syncIdentity();
				posthog.capture(APP_OPENED_EVENT, appVersion ? { appVersion } : {});
				return;
			}

			posthog.opt_out_capturing();
		}),
		(error) => normalizeError(error instanceof Error ? error : undefined, "Failed to update PostHog preference")
	).match(
		() => undefined,
		(error) => {
			logger.warn("Failed to apply analytics preference", { error, enabled });
		}
	);
}

export function isAnalyticsEnabled(): boolean {
	return analyticsEnabled;
}

export function __resetAnalyticsForTests(): void {
	analyticsEnabled = true;
	initPromise = null;
	sentryInitialized = false;
	posthogInitialized = false;
	distinctId = null;
	appVersion = null;
}
