import * as Effect from "effect/Effect";
import {
	bindQaResultHandler,
	createTokenState,
	makeQaBridgeClient,
	makeQaSession,
	QaWindowInfo,
	startQaHost,
} from "electrobun-qa";

export type QaHostAttachment =
	| { readonly started: true; readonly path: string }
	| { readonly started: false; readonly path: null };

export type AttachQaHostInput = {
	readonly signed: boolean;
	readonly path: string;
	readonly title: string;
	readonly url: string;
	readonly sender: {
		readonly executeJavascript: (js: string) => void;
	};
	readonly message: Record<string, (payload: unknown) => void>;
};

export const qaWindowPreload = (enabled: boolean, script: string): string | null => {
	if (enabled === true) {
		return script;
	}
	return null;
};

export const qaInternalMessageMap = (message: object): Record<string, (payload: unknown) => void> =>
	message as Record<string, (payload: unknown) => void>;

export const attachQaHost = Effect.fn("attachQaHost")(function* (input: AttachQaHostInput) {
	if (input.signed === true) {
		return { started: false as const, path: null };
	}
	const client = makeQaBridgeClient({
		sender: input.sender,
		tokens: createTokenState(),
	});
	bindQaResultHandler({ message: input.message }, (payload) => {
		Effect.runFork(client.receiveResult(payload));
	});
	const session = makeQaSession({
		windows: [
			QaWindowInfo.make({
				id: "1",
				title: input.title,
				url: input.url,
			}),
		],
		client,
	});
	const host = yield* startQaHost({
		signed: false,
		path: input.path,
		session,
	});
	return { started: true as const, path: host.path };
});

export const keepQaHost = Effect.fn("keepQaHost")(function* (input: AttachQaHostInput) {
	const attached = yield* attachQaHost(input);
	if (attached.started === true) {
		yield* Effect.never;
	}
	return attached;
});
