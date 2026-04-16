import { beforeEach, describe, expect, it, mock } from "bun:test";

const getMock = mock(() => ({ match: (ok: (value: boolean | null) => boolean) => ok(null) }));
const sentryInitMock = mock(() => undefined);
const sentrySetUserMock = mock(() => undefined);
const sentryWithScopeMock = mock((callback: (scope: { setExtra: (key: string, value: string | number | boolean) => void }) => void) => {
	callback({
		setExtra: () => undefined,
	});
});
const sentryCaptureExceptionMock = mock(() => undefined);
const posthogInitMock = mock(() => undefined);
const posthogIdentifyMock = mock(() => undefined);
const posthogCaptureMock = mock(() => undefined);
const posthogOptInMock = mock(() => undefined);
const posthogOptOutMock = mock(() => undefined);
const getVersionMock = mock(async () => "1.2.3");

const storage = new Map<string, string>();

mock.module("$lib/acp/utils/logger.js", () => ({
	createLogger: () => ({
		debug: () => {},
		info: () => {},
		isLevelEnabled: () => false,
		warn: () => {},
		error: () => {},
	}),
}));

mock.module("$lib/utils/tauri-client/settings.js", () => ({
	settings: {
		get: getMock,
	},
}));

mock.module("@tauri-apps/api/app", () => ({
	getVersion: getVersionMock,
}));

mock.module("@sentry/browser", () => ({
	init: sentryInitMock,
	setUser: sentrySetUserMock,
	withScope: sentryWithScopeMock,
	captureException: sentryCaptureExceptionMock,
}));

mock.module("posthog-js", () => ({
	default: {
		init: posthogInitMock,
		identify: posthogIdentifyMock,
		capture: posthogCaptureMock,
		opt_in_capturing: posthogOptInMock,
		opt_out_capturing: posthogOptOutMock,
	},
}));

import {
	__resetAnalyticsForTests,
	captureCommandFailure,
	captureContractViolation,
	captureEvent,
	captureException,
	initAnalytics,
	setAnalyticsEnabled,
} from "./analytics.js";

function setupEnv() {
	Object.assign(import.meta.env, {
		DEV: false,
		VITE_FORCE_ANALYTICS: "1",
		VITE_POSTHOG_KEY: "",
		VITE_SENTRY_DSN: "",
		VITE_POSTHOG_HOST: "",
	});
	Object.defineProperty(globalThis, "window", {
		value: globalThis,
		configurable: true,
	});
	Object.defineProperty(globalThis, "localStorage", {
		value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				storage.set(key, value);
			},
			removeItem: (key: string) => {
				storage.delete(key);
			},
			clear: () => {
				storage.clear();
			},
			key: (index: number) => Array.from(storage.keys())[index] ?? null,
			get length() {
				return storage.size;
			},
		} satisfies Storage,
		configurable: true,
	});
}

describe("analytics", () => {
	beforeEach(() => {
		__resetAnalyticsForTests();
		getMock.mockReset();
		sentryInitMock.mockReset();
		sentrySetUserMock.mockReset();
		sentryWithScopeMock.mockReset();
		sentryCaptureExceptionMock.mockReset();
		posthogInitMock.mockReset();
		posthogIdentifyMock.mockReset();
		posthogCaptureMock.mockReset();
		posthogOptInMock.mockReset();
		posthogOptOutMock.mockReset();
		getVersionMock.mockReset();
		getVersionMock.mockResolvedValue("1.2.3");
		sentryWithScopeMock.mockImplementation(
			(callback: (scope: { setExtra: (key: string, value: string | number | boolean) => void }) => void) => {
				callback({
					setExtra: () => undefined,
				});
			}
		);
		getMock.mockReturnValue({ match: (ok: (value: boolean | null) => boolean) => ok(null) });
		storage.clear();
		setupEnv();
	});

	it("initializes providers and captures app_opened when enabled", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";
		import.meta.env.VITE_SENTRY_DSN = "https://example@sentry.io/123";

		await initAnalytics();

		expect(sentryInitMock).toHaveBeenCalled();
		expect(posthogInitMock).toHaveBeenCalled();
		expect(posthogIdentifyMock).toHaveBeenCalled();
		expect(posthogCaptureMock).toHaveBeenCalledWith("app_opened", { appVersion: "1.2.3" });
	});

	it("does not capture events when opted out", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";
		getMock.mockReturnValue({ match: (ok: (value: boolean | null) => boolean) => ok(true) });

		await initAnalytics();

		expect(posthogCaptureMock).not.toHaveBeenCalled();
	});

	it("captures exceptions after initialization", async () => {
		import.meta.env.VITE_SENTRY_DSN = "https://example@sentry.io/123";

		await initAnalytics();
		captureException(new Error("boom"), { source: "test" });

		expect(sentryCaptureExceptionMock).toHaveBeenCalled();
	});

	it("skips expected command failures", async () => {
		import.meta.env.VITE_SENTRY_DSN = "https://example@sentry.io/123";

		await initAnalytics();
		sentryCaptureExceptionMock.mockReset();
		captureCommandFailure(new Error("expected"), {
			commandName: "save_user_setting",
			invokeId: "invoke-1",
			elapsedMs: 12,
			referenceId: "ref-1",
			referenceSearchable: false,
			classification: "expected",
		});

		expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
	});

	it("suppresses repeated identical unexpected command failures within one session window", async () => {
		import.meta.env.VITE_SENTRY_DSN = "https://example@sentry.io/123";

		await initAnalytics();
		sentryCaptureExceptionMock.mockReset();

		const context = {
			commandName: "save_user_setting",
			invokeId: "invoke-3",
			elapsedMs: 12,
			referenceId: "ref-1",
			referenceSearchable: true,
			classification: "unexpected" as const,
			diagnosticsSummary: "database is locked",
		};

		captureCommandFailure(new Error("boom"), context);
		captureCommandFailure(new Error("boom"), context);

		expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
	});

	it("updates posthog capture state when toggled", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";

		await initAnalytics();
		await setAnalyticsEnabled(false);
		await setAnalyticsEnabled(true);

		expect(posthogOptOutMock).toHaveBeenCalled();
		expect(posthogOptInMock).toHaveBeenCalled();
	});

	it("passes PostHog host from VITE_POSTHOG_HOST env var", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";
		import.meta.env.VITE_POSTHOG_HOST = "https://eu.i.posthog.com";

		await initAnalytics();

		expect(posthogInitMock).toHaveBeenCalled();
		const callArgs = posthogInitMock.mock.calls[0] as Array<Record<string, string>>;
		const config = callArgs[1];
		expect(config.api_host).toBe("https://eu.i.posthog.com");
	});

	it("defaults PostHog host to EU when env var is empty", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";
		import.meta.env.VITE_POSTHOG_HOST = "";

		await initAnalytics();

		expect(posthogInitMock).toHaveBeenCalled();
		const callArgs = posthogInitMock.mock.calls[0] as Array<Record<string, string>>;
		const config = callArgs[1];
		expect(config.api_host).toBe("https://eu.i.posthog.com");
	});

	it("initializes PostHog only when VITE_POSTHOG_KEY is set", async () => {
		import.meta.env.VITE_SENTRY_DSN = "https://example@sentry.io/123";

		await initAnalytics();

		expect(sentryInitMock).toHaveBeenCalled();
		expect(posthogInitMock).not.toHaveBeenCalled();
	});

	it("initializes Sentry only when VITE_SENTRY_DSN is set", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";

		await initAnalytics();

		expect(posthogInitMock).toHaveBeenCalled();
		expect(sentryInitMock).not.toHaveBeenCalled();
	});

	it("captureEvent sends to PostHog when enabled", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";

		await initAnalytics();
		captureEvent("test_event", { version: "1.0" });

		expect(posthogCaptureMock).toHaveBeenCalledWith("test_event", { version: "1.0" });
	});

	it("captureContractViolation emits the contract event with merged properties", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";

		await initAnalytics();
		captureContractViolation("tool_call_update_without_canonical_entry", {
			contract: "wrong_contract",
			source: "test",
			hasRawOutput: true,
		});

		expect(posthogCaptureMock).toHaveBeenCalledWith("contract_violation", {
			contract: "tool_call_update_without_canonical_entry",
			source: "test",
			hasRawOutput: true,
		});
	});

	it("captureEvent is a no-op when opted out", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";
		getMock.mockReturnValue({ match: (ok: (value: boolean | null) => boolean) => ok(true) });

		await initAnalytics();
		posthogCaptureMock.mockReset();
		captureEvent("test_event");

		expect(posthogCaptureMock).not.toHaveBeenCalled();
	});

	it("captureEvent is a no-op before initialization", () => {
		captureEvent("test_event");

		expect(posthogCaptureMock).not.toHaveBeenCalled();
	});

	it("allows retry after init failure", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";
		getVersionMock.mockRejectedValueOnce(new Error("fail"));

		await initAnalytics();
		__resetAnalyticsForTests();
		setupEnv();
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";
		getVersionMock.mockResolvedValue("2.0.0");

		await initAnalytics();

		expect(posthogInitMock).toHaveBeenCalled();
	});

	it("clears device ID on opt-out", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";

		await initAnalytics();
		expect(storage.has("analytics_device_id")).toBe(true);

		await setAnalyticsEnabled(false);
		expect(storage.has("analytics_device_id")).toBe(false);
	});

	it("handles localStorage failure gracefully during init", async () => {
		import.meta.env.VITE_POSTHOG_KEY = "ph_test";
		Object.defineProperty(globalThis, "localStorage", {
			value: {
				getItem: () => { throw new Error("quota exceeded"); },
				setItem: () => { throw new Error("quota exceeded"); },
				removeItem: () => {},
				clear: () => {},
				key: () => null,
				get length() { return 0; },
			} satisfies Storage,
			configurable: true,
		});

		await initAnalytics();
		expect(posthogInitMock).toHaveBeenCalled();
	});
});
