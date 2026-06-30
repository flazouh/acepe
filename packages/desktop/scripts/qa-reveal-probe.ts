// Diagnostic: at each sd-acepeTokenReveal animationstart, sample the element's
// computed opacity. opacity≈0 => a VISIBLE fade is starting (flicker). opacity≈1
// => negative-delay settled-instant word (no visible flicker). Rides QA daemon.
import { z } from "zod";
import { executeWebviewJson } from "./acepe-qa/tauri-mcp";

const APP = "9223";
const installSchema = z.object({ installed: z.boolean() });
const readSchema = z.object({
	revealStarts: z.number(),
	visibleFades: z.number(), // opacity < 0.5 at start
	settledStarts: z.number(), // opacity >= 0.5 at start
	lastBatchVisible: z.number(), // visible fades in the most recent 250ms
	maxBatchVisible: z.number(), // worst 250ms burst of visible fades
	curWords: z.number(),
	mode: z.string().nullable(),
});

const INSTALL = `(() => {
  if (window.__rp) { window.__rp.reset(); return { installed: true }; }
  const s = { starts:0, vis:0, settled:0, batch:[], maxBatch:0 };
  const handler = (e) => {
    if (!e.animationName || e.animationName.indexOf('acepeTokenReveal') < 0) return;
    s.starts++;
    const op = parseFloat(getComputedStyle(e.target).opacity);
    const now = performance.now();
    if (op < 0.5) {
      s.vis++;
      s.batch.push(now);
      // keep only last 250ms
      while (s.batch.length && now - s.batch[0] > 250) s.batch.shift();
      if (s.batch.length > s.maxBatch) s.maxBatch = s.batch.length;
    } else {
      s.settled++;
    }
  };
  document.addEventListener('animationstart', handler, true);
  window.__rp = {
    reset(){ s.starts=0; s.vis=0; s.settled=0; s.batch=[]; s.maxBatch=0; },
    read(){
      const c = document.querySelector("[data-token-reveal-mode]");
      const now = performance.now();
      const recent = s.batch.filter(t => now - t <= 250).length;
      return {
        revealStarts: s.starts,
        visibleFades: s.vis,
        settledStarts: s.settled,
        lastBatchVisible: recent,
        maxBatchVisible: s.maxBatch,
        curWords: document.querySelectorAll("[data-sd-animate]").length,
        mode: c ? (c.getAttribute('data-token-reveal-mode')||null) : null,
      };
    }
  };
  return { installed: true };
})()`;

const READ = `(() => window.__rp ? window.__rp.read() : {revealStarts:-1,visibleFades:0,settledStarts:0,lastBatchVisible:0,maxBatchVisible:0,curWords:0,mode:null})()`;

const cmd = process.argv[2] ?? "read";
const res = await executeWebviewJson({
	appIdentifier: APP,
	script: cmd === "install" ? INSTALL : READ,
	schema: cmd === "install" ? installSchema : readSchema,
	callTimeoutMs: 8000,
});
res.match(
	(v) => process.stdout.write(JSON.stringify(v) + "\n"),
	(e) => { process.stdout.write("ERR " + e.code + ": " + e.message + "\n"); process.exit(1); }
);
