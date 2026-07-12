# Lesson 0002 delivered — Rust adapter / history parser

User requested `/teach` on the Rust adapter / history parser after Lesson 0001 (canonical truth flow). Covered: adapter vs parser naming, live (AgentParser) vs history (disk → FullSession) ingress, session_converter funnel, session_materialization relinking, provider edge maps, and where-to-edit symptom table.

**Evidence:** Not yet — quizzes in lesson are first retrieval check.

**Implications:** Next ZPD options: (a) trace Claude JSONL row end-to-end, (b) SessionOpenSnapshot/reconnect boundary, (c) reconciler funnel deep dive, or (d) walk a concrete bug if user brings one.
