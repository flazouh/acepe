# Acepe Agent-Collaboration Market: Primary-Source Audit

**Checked:** July 11, 2026
**Scope:** Products that combine human collaboration, agent messaging, coding-agent execution, or multi-agent supervision.

## Main conclusion

There are real competitors and adjacent products, but they cluster into different categories:

1. Native human-and-agent messaging workspaces.
2. Agents invoked from existing messaging tools.
3. Local workspaces for one human supervising multiple coding agents.
4. Mature messaging platforms that embed general-purpose agents.

Acepe should not treat every Slack integration as a direct competitor. The closest competitive products are those that own the durable work object: agent identity, execution state, permissions, context, evidence, and review.

## Product comparison

| Product | Mixed human + agent messaging? | Positioning and concrete capabilities | Maturity signal |
|---|---|---|---|
| **Raft** | **Yes—fully native. Closest direct competitor.** | “Where humans and AI agents build together.” Its chat is the workspace: public/private channels, DMs, group DMs, threads, mentions, reactions, files, tasks, and message history. DMs support human↔human, human↔agent, agent↔agent, and groups. Agents have persistent identity and memory and run on user hardware. [Site](https://raft.build/) · [Channels](https://docs.raft.build/features/messaging/channels/) · [DMs](https://docs.raft.build/features/messaging/dms/) · [Threads](https://docs.raft.build/features/messaging/threads/) | Live hosted product with free and paid plans. Enterprise is marked coming soon. The core is closed, but its [public documentation repository](https://github.com/botiverse/raft-docs) was active when checked. |
| **OpenTag** | **Uses existing messaging; no native chat product.** | Source-thread-native, local-first, and executor-neutral. A user mentions a coding agent in Slack, GitHub, GitLab, Linear, Lark, Telegram, or Discord. OpenTag builds a bounded context packet, checks permissions, runs Codex or Claude Code locally, records an audit ledger, and returns artifacts or action receipts to the original thread. [Official GitHub](https://github.com/amplifthq/opentag) | About 1.1k stars and 137 commits when checked; active, early `0.x` software. |
| **HKUDS AgentSpace** | **Yes—native shared workspace, though early.** | “Human + Agents. One Team. One Workspace.” Agents have roles, owners, permissions, approvals, scheduling, audit trails, and runtime bindings. They work across channels, direct conversations, inbox tasks, documents, and task boards. Supports hosted and self-hosted deployment and Claude Code, Codex, OpenClaw, and Hermes runtimes. [Official GitHub](https://github.com/HKUDS/AgentSpace) | About 650 stars and 129 commits when checked; active but no published releases. |
| **Tutti** | **Currently one human + many agents. Multi-user is upcoming.** | “Where people and agents build in tune.” Shares agent conversations, context, files, apps, outputs, tasks, approvals, and running state. Cross-agent `@` references allow Codex to reuse Claude conversations or files. Tutti · VM promises room-scoped sharing across people and their agents but is marked coming soon. [Official site](https://tutti.sh/en) · [Official GitHub](https://github.com/tutti-os/tutti) | About 2k stars, 2,548 commits, and 161 releases when checked. Very active but pre-1.0. |
| **Taskade** | **Yes—shared agent-chat threads plus broad team collaboration.** | “Humans and AI agents share the same thread.” Teams can invite people into public/private chats with one agent or an AI Team. Messages are visible and archived into shared memory. Includes project chat, comments, mentions, multiplayer editing, calls, multi-agent teams, approvals, projects, and automations. [Team Agent Chat](https://www.taskade.com/learn/agents/team-chat) · [Official GitHub](https://github.com/taskade/taskade) | Commercial product operating since 2017 and reporting 500k+ agents deployed. The public GitHub repository is mainly documentation and issues, not the core source. |
| **Mattermost Agents** | **Yes—mature human messaging with agents embedded.** | “Human-Machine Teaming.” Existing channels, DMs, group messages, and threads accept agent bots through mentions. Agents answer in threads using prior context, analyze attachments, summarize conversations, extract actions, and use MCP tools to read, search, and create posts, DMs, and channels. [User docs](https://docs.mattermost.com/end-user-guide/agents.html) · [Agents plugin](https://github.com/mattermost/mattermost-plugin-agents) | Roughly 235 stars and 62 releases when checked. The plugin is pre-installed from Mattermost v10.3, making it the most mature messaging base in this group. |

## Competitive interpretation

### Direct competitors

- **Raft** is the closest direct competitor if Acepe builds native team channels and DMs.
- **AgentSpace** overlaps strongly with the idea of a shared, governed, multi-runtime agent workspace.
- **Tutti** overlaps with Acepe's local multi-harness control plane and is moving toward multi-user rooms.

### Close adjacent products

- **OpenTag** is strong prior art for the Slack/GitHub/Linear mention-to-agent workflow. Its design validates source-thread context, local execution, permission checks, audit receipts, and returning results to the original conversation.
- **Claude Tag** validates the Slack invocation wedge but is provider- and platform-specific.

### Messaging substrates rather than coding-agent workspaces

- **Mattermost** owns mature human messaging and embeds agents into it.
- **Taskade** owns a much broader team productivity and no-code automation workspace.

## What remains open for Acepe

The more defensible gap is not simply mixed human-agent messaging. It is a production-grade software-delivery workroom that combines:

- Several interchangeable coding harnesses.
- Durable execution state and context.
- Repository/worktree isolation.
- Permission and approval policy.
- Live supervision and recovery.
- Structured completion evidence.
- Cross-model review.
- Semantic merge-safety checks.
- A clean path from Slack or Linear discussion to a reviewed GitHub pull request.

That position is narrower than “AI collaboration platform,” but it maps more directly to the pain developers currently describe.

## Naming cautions

- The official Tutti product links to [`tutti-os/tutti`](https://github.com/tutti-os/tutti), not `nutthouse/tutti`.
- [`hsk-kr/agentspace`](https://github.com/hsk-kr/agentspace) is a different, very small project described as a private chat network for agents. Its web UI mainly observes agent activity. It is not the mixed human messaging workspace reviewed above.

## Research caveat

Repository stars, commits, releases, and activity dates are point-in-time signals from July 11, 2026. They measure visible project activity, not revenue, retention, or product-market fit.
