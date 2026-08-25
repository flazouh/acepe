import { prepareSpokenReplyText } from "./speak-reply-text.js";

export type SpokenReplySynth = {
	cancel: () => void;
	speaking: () => boolean;
	speak: (
		text: string,
		handlers: { onend: () => void; onerror: () => void }
	) => void;
};

export type SpeakReplyResult = "spoke" | "stopped" | "empty";

export type SpokenReplyListener = {
	onSpeakingChange: (speaking: boolean) => void;
};

export function toggleSpokenReply(
	text: string,
	synth: SpokenReplySynth,
	listener: SpokenReplyListener,
	thisReplySpeaking = false
): SpeakReplyResult {
	if (thisReplySpeaking) {
		synth.cancel();
		listener.onSpeakingChange(false);
		return "stopped";
	}

	const prepared = prepareSpokenReplyText(text);
	if (prepared === null) {
		return "empty";
	}

	if (synth.speaking()) {
		synth.cancel();
	}

	synth.speak(prepared, {
		onend: () => {
			listener.onSpeakingChange(false);
		},
		onerror: () => {
			listener.onSpeakingChange(false);
		},
	});
	listener.onSpeakingChange(true);
	return "spoke";
}

export function createBrowserSpokenReplySynth(
	speech: SpeechSynthesis
): SpokenReplySynth {
	return {
		speaking: () => speech.speaking,
		cancel: () => {
			speech.cancel();
		},
		speak: (text, handlers) => {
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.onend = () => {
				handlers.onend();
			};
			utterance.onerror = () => {
				handlers.onerror();
			};
			speech.speak(utterance);
		},
	};
}

export function readWindowSpokenReplySynth(): SpokenReplySynth | null {
	if (typeof window === "undefined") {
		return null;
	}
	if (window.speechSynthesis === undefined) {
		return null;
	}
	return createBrowserSpokenReplySynth(window.speechSynthesis);
}
