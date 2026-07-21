import { describe, expect, it } from "vitest";

import { resolveVoiceStateLifecycle } from "../../logic/voice-state-lifecycle.js";
import { VoiceSessionController } from "../voice-session-controller.svelte.js";

type FakeVoiceInputState = {
	readonly sessionId: string;
	readonly registerListeners: () => Promise<void>;
	readonly dispose: () => void;
	readonly isDisposed: () => boolean;
};

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function createFakeVoiceFactory(input: {
	readonly onCreate?: (state: FakeVoiceInputState) => void;
}): {
	readonly factory: (sessionId: string) => FakeVoiceInputState;
	readonly created: FakeVoiceInputState[];
} {
	const created: FakeVoiceInputState[] = [];
	const factory = (sessionId: string): FakeVoiceInputState => {
		const registerGate = createDeferred<void>();
		let disposed = false;
		const state: FakeVoiceInputState = {
			sessionId,
			registerListeners: async () => registerGate.promise,
			dispose: () => {
				disposed = true;
			},
			isDisposed: () => disposed,
		};
		Object.assign(state, {
			resolveRegisterListeners: () => registerGate.resolve(undefined),
		});
		created.push(state);
		input.onCreate?.(state);
		return state;
	};
	return { factory: factory as (sessionId: string) => FakeVoiceInputState, created };
}

describe("VoiceSessionController", () => {
	it("resolves lifecycle the same way as the predicate module", () => {
		expect(resolveVoiceStateLifecycle(null, "session-a", true)).toBe("init");
		expect(resolveVoiceStateLifecycle("session-a", "session-b", true)).toBe("replace");
	});

	it("activates voice state after registerListeners completes", async () => {
		const effectiveSessionId: string | null = "session-a";
		const { factory, created } = createFakeVoiceFactory({});

		const controller = new VoiceSessionController({
			getEffectiveVoiceSessionId: () => effectiveSessionId,
			getVoiceEnabled: () => true,
			createVoiceInputState: factory as never,
		});

		controller.sync();
		const sessionA = created[0] as FakeVoiceInputState & { resolveRegisterListeners: () => void };
		sessionA.resolveRegisterListeners();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect((controller.voiceState as FakeVoiceInputState | null)?.sessionId).toBe("session-a");
		expect(controller.ready).toBe(true);
	});

	it("drops stale init when the session flips before registerListeners resolves", async () => {
		let effectiveSessionId: string | null = "session-a";
		const voiceEnabled = true;
		const { factory, created } = createFakeVoiceFactory({});

		const controller = new VoiceSessionController({
			getEffectiveVoiceSessionId: () => effectiveSessionId,
			getVoiceEnabled: () => voiceEnabled,
			createVoiceInputState: factory as never,
		});

		controller.sync();
		expect(created).toHaveLength(1);
		expect(created[0]?.sessionId).toBe("session-a");

		effectiveSessionId = "session-b";
		controller.sync();
		expect(created).toHaveLength(2);
		expect(created[0]?.isDisposed()).toBe(false);

		const sessionA = created[0] as FakeVoiceInputState & { resolveRegisterListeners: () => void };
		sessionA.resolveRegisterListeners();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(created[0]?.isDisposed()).toBe(true);

		const sessionB = created[1] as FakeVoiceInputState & { resolveRegisterListeners: () => void };
		sessionB.resolveRegisterListeners();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.ready).toBe(true);
		expect((controller.voiceState as FakeVoiceInputState | null)?.sessionId).toBe("session-b");
		expect(sessionB.isDisposed()).toBe(false);
	});

	it("rejects late registerListeners completion after dispose during in-flight init", async () => {
		let effectiveSessionId: string | null = "session-a";
		const voiceEnabled = true;
		const { factory, created } = createFakeVoiceFactory({});

		const controller = new VoiceSessionController({
			getEffectiveVoiceSessionId: () => effectiveSessionId,
			getVoiceEnabled: () => voiceEnabled,
			createVoiceInputState: factory as never,
		});

		controller.sync();
		expect(created).toHaveLength(1);

		effectiveSessionId = "session-b";
		controller.sync();
		expect(created).toHaveLength(2);

		const staleA = created[0] as FakeVoiceInputState & { resolveRegisterListeners: () => void };
		staleA.resolveRegisterListeners();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(created[0]?.isDisposed()).toBe(true);
		expect((controller.voiceState as FakeVoiceInputState | null)?.sessionId).not.toBe("session-a");

		const sessionB = created[1] as FakeVoiceInputState & { resolveRegisterListeners: () => void };
		sessionB.resolveRegisterListeners();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.ready).toBe(true);
		expect((controller.voiceState as FakeVoiceInputState | null)?.sessionId).toBe("session-b");
	});

	it("dispose is idempotent and tears down the active voice state", async () => {
		const effectiveSessionId: string | null = "session-a";
		const { factory, created } = createFakeVoiceFactory({});

		const controller = new VoiceSessionController({
			getEffectiveVoiceSessionId: () => effectiveSessionId,
			getVoiceEnabled: () => true,
			createVoiceInputState: factory as never,
		});

		controller.sync();
		const sessionA = created[0] as FakeVoiceInputState & { resolveRegisterListeners: () => void };
		sessionA.resolveRegisterListeners();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.ready).toBe(true);
		expect(sessionA.isDisposed()).toBe(false);

		controller.dispose();
		expect(controller.voiceState).toBe(null);
		expect(controller.ready).toBe(false);
		expect(sessionA.isDisposed()).toBe(true);

		controller.dispose();
		expect(controller.voiceState).toBe(null);
		expect(created).toHaveLength(1);
	});

	it("ready is true only for the current effective session after init completes", async () => {
		let effectiveSessionId: string | null = "session-a";
		const voiceEnabled = true;
		const { factory, created } = createFakeVoiceFactory({});

		const controller = new VoiceSessionController({
			getEffectiveVoiceSessionId: () => effectiveSessionId,
			getVoiceEnabled: () => voiceEnabled,
			createVoiceInputState: factory as never,
		});

		controller.sync();
		expect(controller.ready).toBe(false);

		const sessionA = created[0] as FakeVoiceInputState & { resolveRegisterListeners: () => void };
		sessionA.resolveRegisterListeners();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.ready).toBe(true);

		effectiveSessionId = "session-b";
		controller.sync();
		expect(controller.ready).toBe(false);

		const sessionB = created[1] as FakeVoiceInputState & { resolveRegisterListeners: () => void };
		sessionB.resolveRegisterListeners();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(controller.ready).toBe(true);
		expect((controller.voiceState as FakeVoiceInputState | null)?.sessionId).toBe("session-b");
	});
});
