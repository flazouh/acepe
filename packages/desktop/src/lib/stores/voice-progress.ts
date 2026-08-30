import type { VoiceAmplitude, VoiceModelDownload } from "@acepe/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { createLogger } from "$lib/acp/utils/logger.js";
import { appRpcClient } from "../rpc/app-client.ts";
import { composeVoiceProgressStore, type VoiceProgressListener } from "./voice-progress-store.ts";

const logger = createLogger({ id: "voice-progress", name: "VoiceProgress" });

/**
 * One page-wide reader of the voice progress lane.
 *
 * The stream is opened the first time something asks to hear it -- the mic
 * button or the settings page -- and stays open for the life of the page.
 * Listeners come and go; the subscription does not, so a composer that is
 * created and destroyed never reopens the stream.
 */
const listeners = new Set<VoiceProgressListener>();
let started = false;

const fanOut: VoiceProgressListener = {
	onAmplitude: (amplitude: VoiceAmplitude | null) => {
		for (const listener of listeners) {
			listener.onAmplitude?.(amplitude);
		}
	},
	onDownload: (download: VoiceModelDownload | null) => {
		for (const listener of listeners) {
			listener.onDownload?.(download);
		}
	},
};

const start = (): void => {
	if (started) {
		return;
	}
	started = true;
	Effect.runFork(
		appRpcClient().pipe(
			Effect.flatMap((client) => {
				const composed = composeVoiceProgressStore({ client });
				composed.subscribe(fanOut);
				return composed.open();
			}),
			Effect.catchCause((cause) =>
				Effect.sync(() => {
					started = false;
					logger.warn("Voice progress stream ended", { error: Cause.pretty(cause) });
				})
			)
		)
	);
};

export const subscribeVoiceProgress = (listener: VoiceProgressListener): (() => void) => {
	listeners.add(listener);
	start();
	return () => {
		listeners.delete(listener);
	};
};

/** Test seam: forget the page-wide subscription. */
export const resetVoiceProgressForTests = (): void => {
	listeners.clear();
	started = false;
};
