/**
 * Canned assistant reply + burst simulator for the streaming-reveal showcase.
 *
 * The real Claude/Cursor/Zed streams arrive in bursts (~15 words every
 * ~470ms), not smoothly — see `reveal-engine.ts`'s doc comment. This module
 * fakes that cadence with `setInterval` so the four reveal panels on the
 * showcase page can be fed identical, wall-clock-synchronized bursts. It is
 * intentionally decoupled from the engine's own frame scheduler: the engine
 * smooths *within* a burst, this simulates the bursts themselves.
 */

/**
 * ~220 words across three paragraphs, a bullet list, and a fenced code
 * block — enough shape for block-fade to have multiple blocks and for
 * buffer-fade to have plenty of word boundaries.
 */
export const DEMO_CONTENT = `Here's a plan for adding debounced search to the project list without pulling in a new state library.

The core idea is to keep the search input's raw value in local state, then derive a debounced copy of it behind a small timer. Only the debounced value should trigger the filter query, so keystrokes stay instant while the more expensive filtering work waits for a pause in typing. This keeps the field feeling responsive even when the underlying list is large.

A few implementation notes worth calling out:

- Debounce at 250ms — long enough to skip mid-word queries, short enough to still feel live.
- Cancel the pending timer on unmount so a stale filter never fires after the component is gone.
- Keep the raw input value separate from the debounced one; the field should never feel laggy even when the query is slow.
- Reset the timer when the user clears the field, so clearing reads as instant rather than delayed.

Here's the shape of the hook:

\`\`\`ts
function useDebouncedValue(value: string, delayMs = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
\`\`\`

Wire the debounced value into the existing \`useProjectSearch\` query and the list should update itself, since it already re-renders on query changes. No extra plumbing needed. Let me know if you'd rather debounce on the server instead — that trades a slightly higher latency floor for fewer wasted client-side re-filters on very large project lists.`;

/** Non-whitespace run plus its trailing whitespace — tokens rejoin to the exact source text. */
const WORD_TOKEN_PATTERN = /\S+\s*/g;

/** Splits `content` into ~`wordsPerBurst`-token chunks whose concatenation reproduces `content` exactly. */
export function splitIntoBursts(content: string, wordsPerBurst: number): readonly string[] {
	const tokens = content.match(WORD_TOKEN_PATTERN) ?? [];
	const bursts: string[] = [];
	for (let index = 0; index < tokens.length; index += wordsPerBurst) {
		bursts.push(tokens.slice(index, index + wordsPerBurst).join(""));
	}
	return bursts;
}

export interface BurstSourceOptions {
	content: string;
	/** Tokens (words) per burst. Default 15, matching Claude's measured cadence. */
	wordsPerBurst?: number;
	/** Milliseconds between bursts. Default 470. */
	cadenceMs?: number;
	/** Called with each delta. Concatenating every delta reproduces `content`. */
	onBurst: (delta: string) => void;
	/** Called once, after the final burst has been delivered. */
	onEnd: () => void;
}

export interface BurstSource {
	/** Stops any previous run, resets to the first burst, and starts emitting on `cadenceMs`. */
	start(): void;
	/** Stops emitting. Safe to call even if not running. */
	stop(): void;
}

const DEFAULT_WORDS_PER_BURST = 15;
const DEFAULT_CADENCE_MS = 470;

/** setInterval-driven burst emitter. Deliberately NOT the engine's frame scheduler — that smooths within a burst; this fakes the bursts arriving from the model. */
export function createBurstSource(options: BurstSourceOptions): BurstSource {
	const wordsPerBurst = options.wordsPerBurst ?? DEFAULT_WORDS_PER_BURST;
	const cadenceMs = options.cadenceMs ?? DEFAULT_CADENCE_MS;
	const bursts = splitIntoBursts(options.content, wordsPerBurst);

	let timer: ReturnType<typeof setInterval> | null = null;
	let nextIndex = 0;

	function stop(): void {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	}

	function tick(): void {
		if (nextIndex >= bursts.length) {
			stop();
			options.onEnd();
			return;
		}
		options.onBurst(bursts[nextIndex]);
		nextIndex += 1;
	}

	return {
		start(): void {
			stop();
			nextIndex = 0;
			timer = setInterval(tick, cadenceMs);
		},
		stop,
	};
}
