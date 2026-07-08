// Read computed animation-delay/opacity of first vs last revealed word during streaming.
import { z } from "zod";
import { executeWebviewJson } from "./acepe-qa/tauri-mcp";

const APP = "9223";
const schema = z.object({
	words: z.number(),
	mode: z.string().nullable(),
	baselineVar: z.string(),
	firstDelay: z.string(),
	firstSdDelay: z.string(),
	firstOpacity: z.string(),
	lastDelay: z.string(),
	lastSdDelay: z.string(),
	lastOpacity: z.string(),
});

const READ = `(() => {
  const c = document.querySelector("[data-token-reveal-mode]");
  const spans = document.querySelectorAll("[data-sd-animate]");
  const first = spans[0], last = spans[spans.length-1];
  const cs = (el) => el ? getComputedStyle(el) : null;
  const f = cs(first), l = cs(last);
  const v = (el,p) => el ? (el.style.getPropertyValue(p) || cs(el).getPropertyValue(p)) : "";
  return {
    words: spans.length,
    mode: c ? (c.getAttribute('data-token-reveal-mode')||null) : null,
    baselineVar: c ? getComputedStyle(c).getPropertyValue('--token-reveal-baseline-ms') : "",
    firstDelay: f ? f.animationDelay : "",
    firstSdDelay: first ? first.style.getPropertyValue('--sd-delay') : "",
    firstOpacity: f ? f.opacity : "",
    lastDelay: l ? l.animationDelay : "",
    lastSdDelay: last ? last.style.getPropertyValue('--sd-delay') : "",
    lastOpacity: l ? l.opacity : "",
  };
})()`;

const res = await executeWebviewJson({ appIdentifier: APP, script: READ, schema, callTimeoutMs: 8000 });
res.match(
	(v) => process.stdout.write(JSON.stringify(v) + "\n"),
	(e) => { process.stdout.write("ERR " + e.code + ": " + e.message + "\n"); process.exit(1); }
);
