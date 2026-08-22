import {
	applyEventToRpcSessionSnapshot,
	CommandId,
	emptyRpcSessionSnapshot,
	type OrchestrationEvent,
	type RpcClient,
	type RpcSessionSnapshot,
	settingsSnapshotRequest,
} from "@acepe/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Stream from "effect/Stream";

import { CODE_FONT_SIZE, codeFontSizeFromSettings, nextFontSize, parseSettingPx, UI_FONT_SIZE, uiFontSizeFromSettings } from "./settings-font.ts";

const SETTINGS_EVENT_TYPES = HashSet.fromIterable(["SettingsUpdated"]);

export const isSettingsProjectionEvent = (event: OrchestrationEvent): boolean =>
	HashSet.has(SETTINGS_EVENT_TYPES, event.type);

export const composeSettingsStore = (input: {
	readonly client: RpcClient;
	readonly nextCommandId?: () => CommandId;
	readonly onSnapshot?: (snapshot: RpcSessionSnapshot) => void;
}) => {
	let current = emptyRpcSessionSnapshot(0);
	let commandCount = 0;
	let pendingUiFontSize: number | null = null;
	let pendingCodeFontSize: number | null = null;

	const allocateCommandId = Effect.fn("allocateSettingsCommandId")(function* () {
		if (input.nextCommandId !== undefined) {
			return input.nextCommandId();
		}
		commandCount += 1;
		const now = yield* Clock.currentTimeMillis;
		return CommandId.make(`settings-set-${String(now)}-${String(commandCount)}`);
	});

	const readSnapshot = () => current;

	const clearReachedPending = (snapshot: RpcSessionSnapshot) => {
		if (pendingUiFontSize !== null && uiFontSizeFromSettings(snapshot.settings) === pendingUiFontSize) {
			pendingUiFontSize = null;
		}
		if (
			pendingCodeFontSize !== null &&
			codeFontSizeFromSettings(snapshot.settings) === pendingCodeFontSize
		) {
			pendingCodeFontSize = null;
		}
	};

	const replaceSnapshot = (snapshot: RpcSessionSnapshot) => {
		if (snapshot.snapshotSequence < current.snapshotSequence) {
			return;
		}
		current = snapshot;
		clearReachedPending(snapshot);
		if (input.onSnapshot !== undefined) {
			input.onSnapshot(snapshot);
		}
	};

	const refreshSettings = Effect.fn("refreshSettings")(function* () {
		const snap = yield* input.client.snapshot(settingsSnapshotRequest());
		replaceSnapshot(snap);
		return snap;
	});

	const openSettings = Effect.fn("openSettings")(function* () {
		const snap = yield* refreshSettings();
		yield* input.client.events(snap.snapshotSequence).pipe(
			Stream.runForEach((event) => {
				if (isSettingsProjectionEvent(event) === false) {
					return Effect.void;
				}
				replaceSnapshot(applyEventToRpcSessionSnapshot(readSnapshot(), event));
				return Effect.void;
			}),
		);
	});

	const setUiFontSize = Effect.fn("setUiFontSize")(function* (value: number) {
		const clamped = parseSettingPx(String(value), UI_FONT_SIZE);
		yield* input.client.dispatch({
			type: "settings.set",
			commandId: yield* allocateCommandId(),
			key: "ui_font_size",
			value: String(clamped),
		});
		yield* refreshSettings();
	});

	const setCodeFontSize = Effect.fn("setCodeFontSize")(function* (value: number) {
		const clamped = parseSettingPx(String(value), CODE_FONT_SIZE);
		yield* input.client.dispatch({
			type: "settings.set",
			commandId: yield* allocateCommandId(),
			key: "code_font_size",
			value: String(clamped),
		});
		yield* refreshSettings();
	});

	const bumpUiFontSize = Effect.fn("bumpUiFontSize")(function* (delta: number) {
		const base = pendingUiFontSize ?? uiFontSizeFromSettings(readSnapshot().settings);
		const next = nextFontSize(base, delta, UI_FONT_SIZE);
		pendingUiFontSize = next;
		yield* setUiFontSize(next);
	});

	const bumpCodeFontSize = Effect.fn("bumpCodeFontSize")(function* (delta: number) {
		const base = pendingCodeFontSize ?? codeFontSizeFromSettings(readSnapshot().settings);
		const next = nextFontSize(base, delta, CODE_FONT_SIZE);
		pendingCodeFontSize = next;
		yield* setCodeFontSize(next);
	});

	return {
		openSettings,
		setUiFontSize,
		setCodeFontSize,
		bumpUiFontSize,
		bumpCodeFontSize,
		readSnapshot,
	};
};
