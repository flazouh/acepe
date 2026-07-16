---
date: 2026-04-13
topic: gpui-agent-panel-poc
---

# GPUI Agent Panel POC

## Problem Frame
Acepe's current desktop product is a Tauri 2 + SvelteKit 2 + Svelte 5 app with a rich agent panel that already carries the product's hardest UI and runtime pressures: long-lived session rendering, streaming output, tool-call inspection, composer/send flow, and provider-integrated agent workflows. We want to know whether a full rewrite of the desktop UI onto Zed's GPUI is actually plausible, not merely whether GPUI can render a nice-looking demo.

For this POC to answer that question honestly, it must reproduce the real Acepe agent panel rather than a simplified interpretation. The spike should preserve Acepe's agent-agnostic architecture, wire real GitHub Copilot behavior end-to-end, and prove that GPUI can match the current panel pixel-for-pixel while also improving both responsiveness and resource behavior enough to justify the rewrite risk. A successful result should be treated as a strong positive signal for broader rewrite planning because it proves the hardest desktop surface is portable, but it must still leave an explicit record of any non-panel risks that remain unresolved.

| Approach | Description | Pros | Cons | Best suited |
|---|---|---|---|---|
| Narrow widget demo | Rebuild a small conversation widget or isolated panel fragment in GPUI. | Fastest to start, lowest short-term cost. | Does not answer rewrite feasibility, hides architecture and runtime pressure, and can produce false confidence. | Only for library familiarization, not for this decision. |
| Full agent panel POC with one real provider | Rebuild the full agent panel in GPUI with pixel-parity goals, real Copilot integration, and the same agent-agnostic architectural seams. | Best balance of realism and bounded scope; directly tests parity, architecture, and performance. | Still substantial work and requires disciplined scope control. | **Recommended** for deciding whether a full rewrite is plausible. |
| Broad app-shell rewrite | Rebuild large parts of the desktop app around GPUI immediately. | Maximum upside if GPUI is clearly the future. | Too many variables at once; failure would not reveal whether GPUI or the chosen scope was the problem. | Only after a convincing panel POC succeeds. |

**Recommendation:** pursue a full agent panel POC with one real provider, using the existing Acepe architecture as the baseline contract rather than redesigning the product around a Copilot-specific or GPUI-specific model.

## Requirements

**POC target**
- R1. The POC must reproduce the full visible Acepe agent panel, not just a representative subset such as the conversation timeline or composer alone.
- R2. The minimum visible surface inventory for parity includes the header, main conversation content, scroll affordances, inline panel cards and strips, composer, footer controls, checkpoint timeline, review pane, attached-file pane, plan surfaces, terminal drawer, and browser sidebar that are currently part of the panel rooted at `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`.
- R3. For this POC, the required rendered panel surfaces are: header chrome; conversation thread and tool-call rendering; scroll affordances; inline error, worktree, install, permission, PR, modified-files, todo, and queued-message surfaces; composer and send/stop loop; worktree/footer controls; checkpoint timeline; plan header, plan dialog, and plan sidebar; review pane; attached-file pane; terminal drawer; and browser sidebar. These surfaces are in scope even when their current implementation lives outside the agent-panel package today.
- R4. No user-visible panel surface may be silently deferred. If one of the required surfaces is missing or materially different, panel parity cannot be claimed.
- R5. The POC must keep the work bounded to the agent panel and the minimum supporting bridges needed to feed that panel; it does not need to replace the rest of the desktop app before the rewrite-feasibility decision is made.

**Parity and product fidelity**
- R6. The GPUI agent panel must reproduce the current Acepe agent panel UI pixel-for-pixel rather than reinterpreting it in a more native GPUI style.
- R7. The POC must be judged against the current desktop agent panel as the canonical visual and interaction reference, especially the panel rooted at `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` and its presentational descendants.
- R8. Before implementation begins, the project must lock a canonical parity contract covering the comparison environment, including platform/theme, window size, panel width, display scale, font conditions, baseline session fixtures, capture method, and diff rule. Pixel-parity claims are valid only against that locked contract.
- R9. Parity review must cover the named panel states below rather than a single golden screenshot.
- R10. Interaction parity is part of the requirement, not a bonus. Review must include scrolling behavior, focus and selection handling, panel-local open/close behavior, tool-call inspection and expansion behavior, and composer/send/stop interactions.

| Parity state | What must be true |
|---|---|
| Historical reading state | A representative finished session with rich tool-call history, status surfaces, and composer visible matches the current panel visually and behaviorally. |
| Live streaming state | A live Copilot-backed session with streaming output and active tool-call updates matches the current panel and remains usable during updates. |
| Inspection state | Modified-files, review, plan, checkpoint, and tool inspection surfaces match the current panel when opened from the main panel flow. |
| Auxiliary surface state | Attached-file, terminal, and browser panel-local surfaces match the current panel when active. |
| Error and recovery state | Error, reconnect, install, and worktree-related surfaces match the current panel and preserve the same visible recovery path. |

**Architecture and provider boundaries**
- R11. The POC must preserve Acepe's agent-agnostic architecture rather than coupling the new panel to GitHub Copilot concepts, names, or workflows beyond the provider adapter boundary.
- R12. GitHub Copilot must be the only provider that works end-to-end in the POC, but the architecture must remain structurally capable of supporting other providers later without a panel rewrite.
- R13. The POC must reuse or mirror the existing Acepe model/controller seams where possible so the experiment tests GPUI as a rendering/runtime choice, not a simultaneous product architecture redesign.
- R14. Provider-specific logic must remain isolated to the same kind of adapter/edge seams Acepe already uses; the GPUI panel must consume provider-neutral panel/session models rather than talking directly to Copilot-specific internals.
- R15. Non-panel work is in scope only when it is a thin bridge or reuse layer required to feed the GPUI panel from existing Acepe session, provider, ACP, or persistence services. Re-platforming non-panel navigation, settings, workspace management, unrelated providers, or unrelated Tauri services is out of scope.
- R16. A rewrite-positive result requires an explicit provider-neutral acceptance check for the panel layer, such as a panel model contract, forbidden-dependency check, or equivalent review artifact that can fail if Copilot-specific assumptions leak past the adapter boundary.

**Runtime realism**
- R17. The POC must use real Acepe data flow and real Copilot integration for the core panel loop rather than relying primarily on mocked demo data.
- R18. The following flows are non-negotiably real for a rewrite-positive result: loading an existing Copilot-backed session into the panel, rendering live streaming updates and tool-call activity from a real Copilot session, sending a new prompt through the panel, and reflecting the resulting status/error/tool transitions in the panel.
- R19. Mocking any of the non-negotiable flows in R18 disqualifies the POC from supporting a rewrite-positive conclusion.
- R20. Any mocked or simulated behavior outside R18 must be explicit, narrow, and visibly documented so the result is not mistaken for full runtime fidelity.
- R21. The POC must be honest about long-lived, streaming, inspection-heavy usage rather than optimized only for one golden static state.

**First milestone**
- R22. The first executable milestone inside the new GPUI package is a standalone app with only two visible regions: a content panel and a composer with submit.
- R23. The first milestone must support a single ephemeral session with unlimited turns until restart; persistence, session switching, and session recovery are out of scope for that milestone.
- R24. The first milestone composer is text-only and disables submit while a response is actively streaming.
- R25. The first milestone thread must show the optimistic user message immediately on submit, stream the assistant response live, and surface tool-call rows live as they begin.
- R26. The first milestone should preserve the current Acepe visible relationship between assistant output and tool-call rows, but it does not need markdown rendering yet.
- R27. The first milestone should use a single known-good window size, no auto-scroll behavior, no header or panel chrome beyond the content area and composer, and no copy/selection requirements yet.
- R28. Before the first assistant tokens appear, the content panel should show a simple "planning next move" waiting treatment.
- R29. If the request fails in the first milestone, the panel may show a simple error message rather than the full current Acepe error treatment.

**Decision threshold**
- R30. Success is not merely that the panel can be rebuilt; the POC must also demonstrate that GPUI materially improves the current panel on responsiveness and resource behavior in representative use.
- R31. The benchmark scenario set for this decision is fixed now: it must include a long finished-session reading/scroll scenario, a live streaming Copilot session with tool activity, a composer send loop on a loaded panel, and at least one scenario with a secondary panel surface open such as review, plan, terminal, or browser.
- R32. The benchmark metric categories for this decision are fixed now: they must include at minimum one responsiveness metric and one resource metric across the locked scenarios, such as frame stability during scroll/stream, input-to-visible update latency, and steady-state CPU or memory usage.
- R33. Before implementation begins, the project must lock the exact benchmark protocol for R31-R32, including the chosen metrics, capture method, run count, warm-up rules, aggregation method, and pass/fail evidence format.
- R34. The benchmark protocol does not need a predefined numeric pass threshold. Instead, it must produce evidence strong enough for the user to judge whether the GPUI panel is materially better overall without hand-waving.
- R35. If the POC cannot hit parity, architecture safety, and a convincing benchmark result together, the result should count against choosing a broader GPUI rewrite direction.
- R36. A successful result is allowed to support broader rewrite planning because it proves the hardest desktop surface is portable, but it must also ship with an explicit list of remaining non-panel rewrite risks rather than pretending those risks are already solved.

## Success Criteria
- The GPUI panel matches the current desktop panel under the locked parity contract across the named parity states, with no missing required surfaces.
- GitHub Copilot works end-to-end through the GPUI panel on the non-negotiable real flows in R18, with no mocked substitute for those flows.
- The GPUI implementation preserves a provider-neutral panel architecture instead of hard-coding Copilot assumptions into the product-facing UI layer.
- The GPUI panel produces benchmark evidence from R31-R34 that is strong enough for the user to conclude the panel is materially better than the current one.
- The final outcome is strong enough to justify broader GPUI rewrite planning for Acepe while explicitly listing the non-panel risks that remain unproven.

## Scope Boundaries
- Do not treat this POC as a broad app-shell migration beyond what the agent panel and its minimum supporting bridges need.
- Do not redesign the Acepe agent panel to better fit GPUI; parity with the existing panel is the requirement.
- Do not use the POC to justify a Copilot-shaped architecture that would undermine Acepe's agent-agnostic product direction.
- Do not claim success from a mocked or static prototype that avoids the non-negotiable real flows in R18.
- Do not require additional providers to work end-to-end in this phase.
- Validation work is in scope, and the parity/benchmark tooling may be built as reusable repo-grade infrastructure when that meaningfully improves this POC and future GPUI validation work.

## Key Decisions
- **Panel-first feasibility probe:** The agent panel is the right spike surface because it concentrates the hardest combination of rendering, streaming, inspection, and provider interaction concerns already present in Acepe.
- **Exact-parity standard:** This POC is intended to answer rewrite plausibility, so "close enough" visuals or a native reinterpretation would weaken the decision value.
- **Real Copilot, architecture-neutral panel:** Copilot is the real provider for the POC, but the panel and its models must stay structurally provider-neutral so the experiment does not buy speed by corrupting the product architecture.
- **Fresh GPUI decomposition is allowed:** the rendered UI and user-visible behavior are the source of truth, not the current Svelte component seams.
- **First milestone is a minimal real loop:** start with a standalone content panel plus text-only composer that can send a real message, stream a real response, and render near-real tool-call rows before layering the rest of the panel back in.
- **Rewrite decision requires performance upside:** Matching the current UI is necessary but insufficient; the migration only becomes rewrite-positive if GPUI also produces convincing benchmark evidence under the locked scenarios.
- **Positive result proves the hardest surface first, not every surface at once:** A successful panel POC is allowed to justify broader rewrite planning, but only alongside an explicit list of non-panel risks that remain open.

## Dependencies / Assumptions
- The current desktop agent panel and its surrounding scene/model layers are a sufficiently accurate baseline to use as the visual and behavioral source of truth for the POC.
- Acepe's current provider and ACP seams are strong enough to reuse or mirror in the GPUI experiment without first redesigning the whole product architecture.
- Real Copilot integration can be carried far enough into the POC to expose the relevant panel/runtime tradeoffs.

## Outstanding Questions

### Deferred to Planning
- [Affects R8-R10][Technical] What concrete artifact pipeline should implement the locked parity contract: screenshot diffing, fixture capture, state driver harness, or a layered combination?
- [Affects R13-R29][Technical] Which current panel model/controller seams should be reused directly, mirrored, or redefined to keep the GPUI POC agent-agnostic without duplicating product logic?
- [Affects R17-R20][Needs research] Which parts of the current Copilot integration can be reused as-is in a GPUI target, and which edges will require bridging work?
- [Affects R31-R34][Technical] What reusable repo-grade harness should collect the locked responsiveness and resource metrics in a repeatable way inside this repo?

## Next Steps
-> Create a structured implementation plan in docs/plans/