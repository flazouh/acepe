/**
 * Reading QA mode out of the window URL.
 *
 * QA mode is a property of the boot, not of a separate route: `?qa=<scenario>`
 * boots the real app shell against a replayed scenario instead of the live
 * server. Same components, same stores, same reducer, no agent and no cost.
 *
 * Kept pure so the parsing rules are testable without a window.
 */

export type QaMode = {
	readonly scenario: string;
	/** 1 is capture speed, 0 removes every delay. */
	readonly rate: number;
	readonly autoPlay: boolean;
};

const DEFAULT_RATE = 1;

const readRate = (raw: string | null): number => {
	if (raw === null) {
		return DEFAULT_RATE;
	}
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RATE;
};

export const readQaMode = (search: string): QaMode | null => {
	const params = new URLSearchParams(search);
	const scenario = params.get("qa");
	if (scenario === null || scenario.length === 0) {
		return null;
	}
	return {
		scenario,
		rate: readRate(params.get("rate")),
		autoPlay: params.get("autoplay") !== "0",
	};
};
