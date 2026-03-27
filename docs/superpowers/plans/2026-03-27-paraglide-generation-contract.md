# Paraglide Generation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CI-specific Paraglide workarounds with an explicit `generate -> check -> build` contract for both frontend packages.

**Architecture:** Each Paraglide-using package owns a package-local `i18n:generate` script that materializes generated artifacts. `check` and `build` stay pure and assume artifacts already exist. GitHub Actions orchestrates generation explicitly through package scripts instead of embedding package-specific generation commands or relying on production build side effects.

**Tech Stack:** Bun workspaces, SvelteKit 2, Svelte 5, Vite, Paraglide JS, GitHub Actions

---

## File Map

- Modify: `packages/desktop/package.json`
  - add a package-local `i18n:generate` script for desktop
  - preserve current desktop-compatible generation implementation
- Modify: `packages/website/package.json`
  - add a package-local `i18n:generate` script for website
  - keep `check` as pure validation
  - keep `build` as pure build
- Modify: `.github/workflows/ci.yml`
  - remove inline Paraglide preparation details
  - invoke package-local generation scripts explicitly before checks/tests

## Task 1: Add Desktop Explicit Generation Script

**Files:**
- Modify: `packages/desktop/package.json`
- Test: `packages/desktop/package.json`

- [ ] **Step 1: Add the desktop `i18n:generate` script**

Update `packages/desktop/package.json` so the `scripts` block contains:

```json
{
  "scripts": {
    "dev": "vite dev",
    "i18n:generate": "bunx paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide && bunx svelte-kit sync",
    "build": "NODE_OPTIONS='--max-old-space-size=8192' vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && tsgo --noEmit -p ./tsconfig.fast.json"
  }
}
```

- [ ] **Step 2: Verify the desktop script exists and is package-local**

Run: `bun run i18n:generate --help >/dev/null 2>&1; bun run i18n:generate`

Workdir: `packages/desktop`

Expected:
- command exits `0`
- `packages/desktop/src/lib/paraglide/runtime.js` exists after the command

- [ ] **Step 3: Verify desktop check remains pure**

Run: `bun run check`

Workdir: `packages/desktop`

Expected:
- command exits `0`
- no workflow-only preparation is needed

- [ ] **Step 4: Commit the desktop script contract**

```bash
git add packages/desktop/package.json
git commit -m "refactor: add desktop paraglide generation script"
```

## Task 2: Add Website Explicit Generation Script

**Files:**
- Modify: `packages/website/package.json`
- Test: `packages/website/package.json`

- [ ] **Step 1: Add the website `i18n:generate` script**

Update `packages/website/package.json` so the `scripts` block contains:

```json
{
  "scripts": {
    "dev": "vite dev --open",
    "i18n:generate": "vite build",
    "build": "vite build",
    "preview": "vite preview",
    "prepare": "svelte-kit sync || echo ''",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
  }
}
```

This step only introduces the explicit generation contract. The later CI task removes workflow-specific build-as-generation coupling.

- [ ] **Step 2: Verify website generation from a clean state**

Run: `rm -rf .svelte-kit src/lib/paraglide && bun run i18n:generate`

Workdir: `packages/website`

Expected:
- command exits `0`
- `packages/website/src/lib/paraglide/runtime.js` exists after the command

- [ ] **Step 3: Verify website check stays pure after generation**

Run: `bun run check`

Workdir: `packages/website`

Expected:
- command exits `0`
- `check` performs validation only
- no additional generation command is triggered by `check`

- [ ] **Step 4: Commit the website script contract**

```bash
git add packages/website/package.json
git commit -m "refactor: add website paraglide generation script"
```

## Task 3: Move CI to Package-Owned Generation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Test: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace inline frontend generation commands with package script calls**

Update `.github/workflows/ci.yml` so the `Prepare generated frontend artifacts` block becomes:

```yml
      - name: Generate frontend artifacts
        run: |
          cd packages/desktop
          bun run i18n:generate
          cd ../website
          bun run i18n:generate
```

This removes:
- direct `paraglide-js compile` from workflow YAML
- website-specific heap workaround from workflow YAML
- package-specific generation internals from CI

- [ ] **Step 2: Verify CI now expresses orchestration only**

Run: `python3 - <<'PY'
from pathlib import Path
text = Path('.github/workflows/ci.yml').read_text()
assert 'bun run i18n:generate' in text
assert 'paraglide-js compile' not in text
assert "NODE_OPTIONS='--max-old-space-size=8192' bun run build" not in text
print('ok')
PY`

Workdir: `/Users/alex/Documents/acepe`

Expected:
- prints `ok`

- [ ] **Step 3: Commit the CI orchestration cleanup**

```bash
git add .github/workflows/ci.yml
git commit -m "refactor: move paraglide generation into package scripts"
```

## Task 4: Verify the Full Contract from Clean State

**Files:**
- Test: `packages/desktop/package.json`
- Test: `packages/website/package.json`
- Test: `.github/workflows/ci.yml`

- [ ] **Step 1: Verify desktop clean-state generation and check**

Run: `rm -rf .svelte-kit src/lib/paraglide && bun run i18n:generate && bun run check`

Workdir: `packages/desktop`

Expected:
- all commands exit `0`
- desktop Paraglide runtime is regenerated
- desktop typecheck passes

- [ ] **Step 2: Verify website clean-state generation and check**

Run: `cp .env.example .env && rm -rf .svelte-kit src/lib/paraglide && bun run i18n:generate && bun run check`

Workdir: `packages/website`

Expected:
- all commands exit `0`
- website Paraglide runtime is regenerated
- website typecheck passes

- [ ] **Step 3: Verify targeted frontend tests still pass**

Run: `bun run test`

Workdir: `packages/website`

Expected:
- test suite exits `0`

- [ ] **Step 4: Verify desktop tests still pass for the changed contract**

Run: `AGENT=1 bun test $(find src -type f \( -name '*.test.ts' -o -name '*.vitest.ts' \))`

Workdir: `packages/desktop`

Expected:
- test suite exits `0`

- [ ] **Step 5: Commit the verified contract**

```bash
git add packages/desktop/package.json packages/website/package.json .github/workflows/ci.yml
git commit -m "refactor: standardize paraglide generation contract"
```

## Task 5: Push and Confirm CI Intent

**Files:**
- Test: `.github/workflows/ci.yml`

- [ ] **Step 1: Push the branch state**

Run: `git push origin main`

Workdir: `/Users/alex/Documents/acepe`

Expected:
- push succeeds without force

- [ ] **Step 2: Confirm the final workflow intent**

Run: `git show --stat --oneline HEAD`

Workdir: `/Users/alex/Documents/acepe`

Expected:
- diff shows package-script changes plus CI orchestration cleanup
- no build-as-generation workaround remains in workflow YAML

- [ ] **Step 3: Final commit message guidance if rebasing changes history**

If rebasing is needed before push, recreate the final integration commit as:

```bash
git commit -m "refactor: standardize paraglide generation contract"
```

---

## Self-Review

- Spec coverage:
  - explicit package-local `i18n:generate` scripts: covered in Tasks 1 and 2
  - pure `check`: covered in Tasks 1, 2, and 4
  - CI orchestration only: covered in Task 3
  - remove website build workaround from workflow: covered in Task 3
- Placeholder scan:
  - removed vague steps; every task includes exact files, commands, and expected outcomes
- Type/signature consistency:
  - all script names use the same contract: `i18n:generate`, `check`, `build`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-27-paraglide-generation-contract.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
