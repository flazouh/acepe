---
date: 2026-04-23
topic: worktree-app-isolation
---

# Worktree-Scoped Local App Isolation

## Problem Frame

Acepe currently treats local dev launches as one shared app namespace. The desktop app keeps a static product identity, writes its dev SQLite database to a shared local data location, stores agent installer cache under the shared app-data directory, and writes logs to a shared home-directory log folder. That makes QA across multiple checkouts awkward: if the main checkout is already running, a worktree launch does not feel like its own local app instance, and the two runs can collide in local state.

The goal is not to create separately packaged applications for each worktree. The goal is to let developers launch Acepe from the main checkout and from one or more git worktrees at the same time, with each worktree run clearly labeled and fully isolated in its own local Acepe state.

In this document, **main checkout** means the repository's primary/root checkout, and **worktree** means an additional linked git worktree directory distinct from that primary checkout.

## Requirements

**Worktree Detection and Instance Selection**
- R1. Acepe must automatically detect when a local run is starting from a git worktree rather than the main project checkout.
- R2. When Acepe is launched from a detected worktree, it must use a worktree-scoped local runtime namespace instead of the shared default local namespace.
- R3. When Acepe is launched from the main checkout or from a non-worktree context, it must continue using the existing shared local namespace.
- R4. A worktree-launched Acepe instance must be independently launchable as its own app process with its own state initialization, even when another local Acepe instance from the same repo is already running.
- R15. This behavior applies to local source/worktree runs only. Packaged or installed Acepe builds must keep the normal packaged app identity and shared local namespace behavior.

**Worktree-Scoped Local State Isolation**
- R5. A worktree-scoped run must isolate Acepe-managed local state as a whole, not just the primary SQLite database.
- R6. The isolated worktree namespace must include at minimum the local SQLite database (and the Acepe-managed app settings/project metadata it carries), local logs, agent installer cache, other local caches, and any additional Acepe-managed local state paths needed to make the isolation contract complete.
- R7. A worktree-scoped run must not read from or write to the main checkout's Acepe local namespace.
- R8. Two different worktree directories from the same repo must not share the same Acepe-managed local namespace unless they resolve to the same canonical worktree directory.
- R9. The namespace key must be collision-safe across repos, even when two repos both use the same short worktree folder name.

**Visible Instance Identity**
- R10. A worktree-scoped run must visibly identify itself using the worktree folder name so a developer can tell which Acepe window belongs to which worktree at a glance.
- R11. The visible worktree label must use the worktree folder basename and stay short and human-readable rather than showing the full collision-safe storage key.
- R12. This feature must preserve the current single Acepe product/app identity for normal packaged use; the worktree name is a local runtime label, not a new product line.

**Worktree Naming Alignment**
- R13. Acepe-created worktrees must use short adjective-animal style names again so the visible worktree-scoped app labels remain easy to scan during QA.
- R14. The worktree folder name is the source of truth for the user-facing worktree label shown by the isolated app instance.

## Success Criteria

- A developer can run Acepe from the main checkout and from a linked worktree at the same time as separate app processes without Acepe-managed local state collisions.
- A worktree-run app clearly shows which worktree it belongs to using the worktree folder basename.
- A worktree-run app keeps its SQLite DB, logs, caches, and Acepe-managed settings separate from the main checkout and from other worktrees.
- Returning to the main checkout, or launching a packaged build, still behaves like today's normal shared Acepe app.
- Short adjective-animal worktree names make the visible app label readable during multi-instance QA.

## Scope Boundaries

- No per-worktree packaged app products or release channels in this change.
- No user-facing manual selector for choosing the namespace; worktree detection is automatic.
- No attempt to isolate third-party agent home directories or external provider-owned storage that lives outside Acepe-managed local state.
- No requirement to migrate historical shared dev data into per-worktree namespaces automatically.
- No requirement to expose the collision-safe repo-qualified namespace key directly in primary UI copy.
- No orphaned-namespace discovery or cleanup for deleted or renamed worktrees in this change.

## Key Decisions

- **Auto-detect worktrees**: worktree isolation should happen by local runtime context, not by a manual toggle.
- **Process isolation, not second-window isolation**: launching a worktree app means a separately initialized app process, not another window inside an already-running instance.
- **Whole-namespace isolation**: QA correctness matters more than partial sharing, so all Acepe-managed local state for a worktree run is isolated together.
- **Keep packaged app identity stable**: this is a dev/worktree runtime behavior, not a product identity split.
- **Use folder basename for display, repo+folder for storage**: the UI stays short while the underlying namespace remains collision-safe.
- **Return to short worktree names**: adjective-animal names are preferred because they produce readable app labels during parallel QA.

## Dependencies / Assumptions

- The current shared local dev DB lives in a common local data directory via `db::init_db` / `get_db_path`.
- Agent installer cache currently derives from the app-data directory at startup.
- Acepe-managed application-level settings and project metadata live in the Acepe SQLite database, so DB isolation changes that namespace too. Project-level `.acepe.json` files are already stored at the project root and do not require separate worktree isolation.
- Local logging is currently written to a shared home-directory log folder, so logs must be brought into the worktree-scoped namespace for full isolation.

## Outstanding Questions

### Deferred to Planning
- [Affects R1, R2][Technical] What runtime signal should be the source of truth for worktree detection in local launches: cwd, executable path, git metadata lookup, or a combination?
- [Affects R4, R12][Needs research] What is the minimum launch-time identity differentiation needed for concurrent local instances if the OS treats same-identity dev apps as a single running app?
- [Affects R6, R7][Technical] Which Acepe-managed paths still need rerouting beyond DB, logs, and agent installer cache to make the isolation contract complete?
- [Affects R8, R9][Technical] What canonical repo identity should qualify the storage namespace so repo+folder keys are collision-safe and filesystem-safe?
- [Affects R10, R11][Technical] Which visible surfaces should carry the worktree label for local QA: window title only, or additional in-app/dev-facing surfaces as well?
- [Affects R10, R11][Technical] What should the visible label do when a worktree folder basename is too long to stay readable?
- [Affects R13, R14][Technical] What exact rule should govern the short adjective-animal worktree naming path so Acepe-created worktrees and their visible app labels stay aligned?

## Next Steps

-> /ce:plan for structured implementation planning
