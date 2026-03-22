import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

let initAnalytics: typeof import("./analytics.js").initAnalytics;
let analyticsModuleVersion = 0;

const sentryCaptureException = mock(() => {});
const sentryInit = mock(() => {});
const sentrySetTag = mock(() => {});
const sentrySetUser = mock(() => {});

const invokeMock = mock(() => Promise.resolve("distinct-id"));

const storage = new Map<string, string>();

describe("analytics", () => {
	beforeEach(async () => {
		storage.clear();

		mock.module("@sentry/svelte", () => ({
			browserTracingIntegration: () => ({ name: "browser-tracing" }),
			captureException: sentryCaptureException,
			init: sentryInit,
			replayIntegration: () => ({ name: "replay" }),
			setTag: sentrySetTag,
			setUser: sentrySetUser,
		}));

		mock.module("./utils/tauri-commands.js", () => ({
			Commands: {
				storage: {
					get_analytics_distinct_id: "storage.get_analytics_distinct_id",
				},
			},
			invoke: invokeMock,
		}));

		analyticsModuleVersion += 1;
		const module = (await import(
			`./analytics.js?test=${analyticsModuleVersion}`
		)) as typeof import("./analytics.js");
		initAnalytics = module.initAnalytics;

		global.window = {} as Window & typeof globalThis;
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				clear: () => {
					storage.clear();
				},
				getItem: (key: string) => storage.get(key) || null,
				removeItem: (key: string) => {
					storage.delete(key);
				},
				setItem: (key: string, value: string) => {
					storage.set(key, value);
				},
			},
		});
	});

	afterEach(() => {
		sentryCaptureException.mockClear();
		sentryInit.mockClear();
		sentrySetTag.mockClear();
		sentrySetUser.mockClear();
		invokeMock.mockClear();
		storage.clear();
	});

	it("initializes Sentry when DSN is present", () => {
		initAnalytics();

		expect(sentryInit).toHaveBeenCalledTimes(1);
	});
});
