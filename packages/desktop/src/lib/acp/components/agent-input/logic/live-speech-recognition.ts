import * as Effect from "effect/Effect";

export type SpeechRecognitionResultView = {
	readonly isFinal: boolean;
	readonly transcript: string;
};

export type SpeechRecognitionAlternativeLike = {
	readonly transcript: string;
};

export type SpeechRecognitionResultLike = {
	readonly isFinal: boolean;
	readonly length?: number;
	readonly item?: (index: number) => SpeechRecognitionAlternativeLike | null;
	readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
};

export type SpeechRecognitionResultListLike = {
	readonly length: number;
	readonly item?: (index: number) => SpeechRecognitionResultLike | null;
	readonly [index: number]: SpeechRecognitionResultLike | undefined;
};

export type SpeechRecognitionLike = {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onresult: ((event: { results: SpeechRecognitionResultListLike }) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start: () => void;
	stop: () => void;
	abort: () => void;
};

export type SpeechRecognitionConstructor = {
	new (): SpeechRecognitionLike;
};

export type LiveSpeechStartResult = "started" | "failed";

export type LiveSpeechListener = {
	onFailure: (message: string) => void;
};

export type LiveSpeechSession = {
	start: (language: string | null, listener?: LiveSpeechListener) => LiveSpeechStartResult;
	stop: () => Promise<string>;
	abort: () => void;
};

export function speechRecognitionFailureMessage(error: string): string | null {
	if (error === "not-allowed") {
		return "Microphone permission denied";
	}
	if (error === "service-not-allowed") {
		return "Speech recognition is not allowed";
	}
	if (error === "audio-capture") {
		return "No microphone found";
	}
	return null;
}

export function collectSpeechRecognitionText(
	results: readonly SpeechRecognitionResultView[]
): string {
	const finals: string[] = [];
	for (const result of results) {
		if (result.isFinal !== true) {
			continue;
		}
		const transcript = result.transcript.trim();
		if (transcript.length > 0) {
			finals.push(transcript);
		}
	}
	if (finals.length > 0) {
		return finals.join(" ");
	}

	const interims: string[] = [];
	for (const result of results) {
		const transcript = result.transcript.trim();
		if (transcript.length > 0) {
			interims.push(transcript);
		}
	}
	return interims.join(" ");
}

export function readSpeechRecognitionResultViews(
	results: SpeechRecognitionResultListLike
): SpeechRecognitionResultView[] {
	const views: SpeechRecognitionResultView[] = [];
	for (let index = 0; index < results.length; index += 1) {
		const result = results[index] ?? results.item?.(index) ?? null;
		if (result === null) {
			continue;
		}
		const alternative = result[0] ?? result.item?.(0) ?? null;
		views.push({
			isFinal: result.isFinal,
			transcript: alternative?.transcript ?? "",
		});
	}
	return views;
}

export function createBrowserLiveSpeechSession(
	Recognition: SpeechRecognitionConstructor
): LiveSpeechSession {
	let recognition: SpeechRecognitionLike | null = null;
	let transcript = "";
	let running = false;
	let pendingStop: ((text: string) => void) | null = null;

	const finishStop = (): void => {
		const resolve = pendingStop;
		pendingStop = null;
		running = false;
		if (resolve !== null) {
			resolve(transcript);
		}
	};

	return {
		start: (language, listener) => {
			recognition = new Recognition();
			recognition.continuous = true;
			recognition.interimResults = true;
			if (language !== null && language.length > 0) {
				recognition.lang = language;
			}
			transcript = "";
			pendingStop = null;
			recognition.onresult = (event) => {
				transcript = collectSpeechRecognitionText(readSpeechRecognitionResultViews(event.results));
			};
			recognition.onend = () => {
				finishStop();
			};
			recognition.onerror = (event) => {
				const message = speechRecognitionFailureMessage(event.error);
				if (message === null) {
					return;
				}
				listener?.onFailure(message);
			};
			const outcome = Effect.runSync(
				Effect.try({
					try: () => {
						recognition?.start();
					},
					catch: () => "failed" as const,
				}).pipe(
					Effect.match({
						onSuccess: () => "started" as const,
						onFailure: () => "failed" as const,
					})
				)
			);
			if (outcome === "failed") {
				recognition = null;
				return "failed";
			}
			running = true;
			return "started";
		},
		stop: () => {
			return new Promise((resolve) => {
				if (recognition === null || running === false) {
					resolve(transcript);
					return;
				}
				pendingStop = resolve;
				recognition.stop();
			});
		},
		abort: () => {
			pendingStop = null;
			transcript = "";
			if (recognition !== null && running === true) {
				recognition.abort();
			}
			running = false;
			recognition = null;
		},
	};
}

type SpeechWindow = Window & {
	SpeechRecognition?: SpeechRecognitionConstructor;
	webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function readWindowSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
	if (typeof window === "undefined") {
		return null;
	}
	const speechWindow = window as SpeechWindow;
	if (typeof speechWindow.SpeechRecognition === "function") {
		return speechWindow.SpeechRecognition;
	}
	if (typeof speechWindow.webkitSpeechRecognition === "function") {
		return speechWindow.webkitSpeechRecognition;
	}
	return null;
}

export function readWindowLiveSpeechSession(): LiveSpeechSession | null {
	const Recognition = readWindowSpeechRecognitionConstructor();
	if (Recognition === null) {
		return null;
	}
	return createBrowserLiveSpeechSession(Recognition);
}
