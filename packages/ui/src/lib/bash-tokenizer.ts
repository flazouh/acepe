/**
 * Lightweight bash command tokenizer for syntax-highlighted display.
 *
 * Emits HTML with short CSS class names consumed by the execute tool card:
 *   .sh-cmd  — executable / command name (first word after pipe or start)
 *   .sh-flg  — flags  (-x, --verbose)
 *   .sh-str  — quoted strings
 *   .sh-var  — $VARIABLE, ${VAR}, $(…)
 *   .sh-op   — pipe, redirect, semicolon
 *   .sh-cmt  — comments
 */

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Split a compound command on `&&`, `||`, and `;`, respecting quoted strings.
 * Returns the individual command segments (trimmed).
 */
export function splitCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	let i = 0;

	while (i < command.length) {
		const ch = command[i];

		if (ch === "\\" && i + 1 < command.length) {
			current += ch + command[i + 1];
			i += 2;
			continue;
		}

		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			current += ch;
			i++;
			continue;
		}

		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			current += ch;
			i++;
			continue;
		}

		if (!inSingle && !inDouble) {
			// Split on &&
			if (ch === "&" && i + 1 < command.length && command[i + 1] === "&") {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				i += 2;
				continue;
			}

			// Split on ||
			if (ch === "|" && i + 1 < command.length && command[i + 1] === "|") {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				i += 2;
				continue;
			}

			// Split on ; (but not ;;)
			if (ch === ";" && !(i + 1 < command.length && command[i + 1] === ";")) {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				i++;
				continue;
			}
		}

		current += ch;
		i++;
	}

	const trimmed = current.trim();
	if (trimmed) segments.push(trimmed);

	return segments;
}

/**
 * Highlight a single bash command segment.
 * Returns an HTML string with `.sh-*` class spans.
 */
export function highlightBashSegment(segment: string): string {
	const out: string[] = [];
	let i = 0;
	let firstWord = true;

	while (i < segment.length) {
		const ch = segment[i];

		// ── whitespace ──
		if (/\s/.test(ch)) {
			let ws = "";
			while (i < segment.length && /\s/.test(segment[i])) ws += segment[i++];
			out.push(ws);
			continue;
		}

		// ── comment ──
		if (ch === "#") {
			out.push(`<span class="sh-cmt">${esc(segment.slice(i))}</span>`);
			break;
		}

		// ── double-quoted string ──
		if (ch === '"') {
			let s = '"';
			i++;
			while (i < segment.length && segment[i] !== '"') {
				if (segment[i] === "\\" && i + 1 < segment.length) s += segment[i++];
				s += segment[i++];
			}
			if (i < segment.length) s += segment[i++];
			out.push(`<span class="sh-str">${esc(s)}</span>`);
			continue;
		}

		// ── single-quoted string ──
		if (ch === "'") {
			let s = "'";
			i++;
			while (i < segment.length && segment[i] !== "'") s += segment[i++];
			if (i < segment.length) s += segment[i++];
			out.push(`<span class="sh-str">${esc(s)}</span>`);
			continue;
		}

		// ── variable: $VAR, ${VAR}, $(...) ──
		if (ch === "$") {
			let v = "$";
			i++;
			if (i < segment.length && segment[i] === "{") {
				while (i < segment.length && segment[i] !== "}") v += segment[i++];
				if (i < segment.length) v += segment[i++];
			} else if (i < segment.length && segment[i] === "(") {
				let depth = 1;
				v += segment[i++];
				while (i < segment.length && depth > 0) {
					if (segment[i] === "(") depth++;
					if (segment[i] === ")") depth--;
					v += segment[i++];
				}
			} else {
				while (i < segment.length && /[a-zA-Z0-9_]/.test(segment[i]))
					v += segment[i++];
			}
			out.push(`<span class="sh-var">${esc(v)}</span>`);
			continue;
		}

		// ── redirect with fd number: 2>, 2>>, 2>&1 ──
		if (
			/[0-9]/.test(ch) &&
			i + 1 < segment.length &&
			/[><]/.test(segment[i + 1])
		) {
			let op = segment[i++];
			op += segment[i++];
			if (i < segment.length && segment[i] === ">") op += segment[i++];
			if (i < segment.length && segment[i] === "&") {
				op += segment[i++];
				while (i < segment.length && /[0-9]/.test(segment[i]))
					op += segment[i++];
			}
			out.push(`<span class="sh-op">${esc(op)}</span>`);
			continue;
		}

		// ── operators: |, ||, >, >>, <, <<, ; ──
		if (ch === "|" || ch === ">" || ch === "<" || ch === ";") {
			let op = segment[i++];
			if (i < segment.length && segment[i] === op) op += segment[i++];
			if (
				(op === ">" || op === ">>") &&
				i < segment.length &&
				segment[i] === "&"
			) {
				op += segment[i++];
				while (i < segment.length && /[0-9]/.test(segment[i]))
					op += segment[i++];
			}
			out.push(`<span class="sh-op">${esc(op)}</span>`);
			firstWord = true;
			continue;
		}

		// ── word ──
		let w = "";
		while (i < segment.length && !/[\s|><;'"$#]/.test(segment[i])) {
			if (segment[i] === "\\" && i + 1 < segment.length) {
				w += segment[i++];
				w += segment[i++];
			} else {
				w += segment[i++];
			}
		}

		if (w) {
			if (w.startsWith("-")) {
				out.push(`<span class="sh-flg">${esc(w)}</span>`);
			} else if (firstWord) {
				out.push(`<span class="sh-cmd">${esc(w)}</span>`);
				firstWord = false;
			} else {
				out.push(esc(w));
			}
		}
	}

	return out.join("");
}
