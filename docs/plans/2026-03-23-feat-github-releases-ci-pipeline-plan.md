---
title: Migrate Release Pipeline to GitHub Releases CI
type: feat
date: 2026-03-23
deepened: 2026-03-24
---

# Migrate Release Pipeline to GitHub Releases CI

## Enhancement Summary

**Deepened on:** 2026-03-24
**Sections enhanced:** 6
**Research sources:** tauri-action source code, Tauri v2 docs, GitHub Actions runner specs, Apple signing best practices

### Key Improvements
1. Corrected `tauri-action` version pinning (no `v1` tag exists — use `@v0`)
2. Discovered Tauri CLI auto-handles keychain import — but we still need manual setup for vendor binary pre-signing
3. Added `.p12` re-encryption step for OpenSSL 3.x compatibility on CI runners
4. Identified `latest.json` merge behavior across matrix jobs (safe for single-arch)
5. Added concrete workflow YAML based on existing release workflow patterns
6. Clarified notarization adds 2-15 min to CI build time

### Gotchas Discovered
- `tauri-action@v0.6.2` uses `includeUpdaterJson`, `@dev` uses `uploadUpdaterJson` — parameter names differ
- Must sign vendor binaries (ripgrep, claude-agent-acp) BEFORE `tauri build` since they get bundled into the app
- macOS Keychain exports use RC2 encryption which OpenSSL 3.x (on CI runners) rejects — must re-encrypt .p12
- `macos-latest` = `macos-15` arm64 (3 CPUs, 7 GB RAM) — free for public repos
- Bun is NOT pre-installed on macOS runners; Rust IS pre-installed
- Known issue: `codesign` can hang on GitHub Actions if `set-key-partition-list` is missing

---

## Overview

Replace the manual local release script (`bun run production`) and Railway S3 infrastructure with a GitHub Actions CI pipeline that builds, signs, notarizes, and publishes macOS releases to GitHub Releases. This is the standard approach for open-source Tauri apps.

## Problem Statement / Motivation

- Current release is manual-only (`scripts/build/src/production.ts` run locally)
- Binaries hosted on private Railway S3 bucket behind a custom proxy (`infra/bucket-proxy/`)
- Not discoverable — users expect download links on the GitHub repo
- Extra infra to maintain (bucket-proxy Railway service, S3 credentials)
- Only one person can release (whoever has local signing certs + `.env.local`)

## Proposed Solution

1. Create `.github/workflows/release.yml` triggered by `v*` tag pushes
2. Use `tauri-apps/tauri-action@v0` to build + sign + notarize + generate `latest.json`
3. Upload all artifacts (DMG, updater bundle, latest.json) to GitHub Releases
4. Update `tauri.conf.json` updater endpoint to `https://github.com/flazouh/acepe/releases/latest/download/latest.json`
5. Transition existing users via one final S3 release, then sunset Railway infra

## Technical Approach

### Phase 1: GitHub Actions Secrets Setup

Export and configure these secrets in `github.com/flazouh/acepe/settings/secrets/actions`:

| Secret | Source | Notes |
|--------|--------|-------|
| `APPLE_CERTIFICATE` | Export Developer ID cert from Keychain as `.p12`, re-encrypt, then `base64 -i cert.p12` | Base64-encoded, see export steps below |
| `APPLE_CERTIFICATE_PASSWORD` | Password used during .p12 export | |
| `APPLE_SIGNING_IDENTITY` | From `.env.local` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | From `.env.local` | For notarization |
| `APPLE_PASSWORD` | From `.env.local` | App-specific password |
| `APPLE_TEAM_ID` | From `.env.local` (`VALZXQP6W5`) | |
| `TAURI_SIGNING_PRIVATE_KEY` | Content of `~/.tauri/acepe.key` | EdDSA key for updater signatures |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | From `.env.local` | |
| `SENTRY_DSN` | From `.env.local` | Backend error tracking |
| `VITE_SENTRY_DSN` | From `.env.local` | Frontend error tracking |

#### Certificate Export Steps (one-time, run locally)

```bash
# 1. Export from Keychain Access:
#    - Open Keychain Access → login keychain → My Certificates
#    - Find "Developer ID Application: ..." (must show private key underneath)
#    - Right-click certificate → Export → format .p12 → set password

# 2. Re-encrypt for OpenSSL 3.x compatibility (CI runners reject RC2 encryption):
openssl pkcs12 -in original.p12 -out temp.pem -nodes -legacy
openssl pkcs12 -export -in temp.pem -out certificate.p12 -password pass:YOUR_PASSWORD
rm temp.pem

# 3. Base64 encode and copy to clipboard:
base64 -i certificate.p12 | pbcopy
# → Paste into GitHub secret: APPLE_CERTIFICATE
```

### Phase 2: Create Release Workflow

New file: `.github/workflows/release.yml`

**Trigger:** Tag push matching `v*`

**Jobs:**

#### Job 1: `build-acps`
- Reuse signing/artifact pattern from existing release workflows (e.g., `.github/workflows/release.yml`)
- Build Claude ACP binary (`packages/acps/claude`)
- Build on `macos-latest` (= `macos-15` arm64)
- Sign with Developer ID (requires keychain import — see existing release workflow for the pattern)
- Upload as workflow artifact for the next job

#### Job 2: `build-and-release` (depends on `build-acps`)
- Runs on `macos-latest` (arm64, 3 CPUs, 7 GB RAM)

**Steps:**

1. Checkout repo
2. Setup Bun (`oven-sh/setup-bun@v2` — Bun is NOT pre-installed on macOS runners)
3. Setup Rust (`dtolnay/rust-toolchain@stable` with target `aarch64-apple-darwin` — Rust IS pre-installed but we want target control)
4. Install frontend dependencies (`bun install --frozen-lockfile`)
5. Download ACP artifact from job 1, place in `packages/acps/claude/dist/claude-agent-acp`
6. Import Apple certificate into temporary keychain (needed for vendor binary signing BEFORE tauri build):

```bash
CERT_PATH="$RUNNER_TEMP/apple-signing.p12"
KEYCHAIN_PATH="$RUNNER_TEMP/signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -hex 12)"

printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$CERT_PATH"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"  # 6h timeout prevents mid-build lock
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERT_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security list-keychains -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | tr -d '"')
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
rm -f "$CERT_PATH"
```

7. Sign vendor binaries (ripgrep + claude-agent-acp) with `codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" --timestamp` — these must be signed BEFORE `tauri build` bundles them into the app

8. Run `tauri-apps/tauri-action@v0` with:

```yaml
- uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # Updater signing
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    # Code signing — DO NOT set APPLE_CERTIFICATE here since keychain already set up
    # Tauri CLI will find the identity from the existing keychain search list
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
    # Notarization
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    # Analytics
    SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
    VITE_SENTRY_DSN: ${{ secrets.VITE_SENTRY_DSN }}
  with:
    projectPath: packages/desktop
    tagName: v__VERSION__
    releaseName: v__VERSION__
    releaseBody: 'See CHANGELOG.md for details.'
    releaseDraft: false
    prerelease: false
    includeUpdaterJson: true  # generates latest.json with platform entries
    args: --target aarch64-apple-darwin
```

9. `tauri-action` automatically:
   - Builds the Tauri app
   - Signs with the existing keychain identity
   - Notarizes with Apple (adds ~2-15 min)
   - Creates GitHub Release with tag
   - Uploads: `Acepe_2026.3.15_aarch64.dmg`, `Acepe.app.tar.gz`, `Acepe.app.tar.gz.sig`, `latest.json`

10. Cleanup keychain (`if: always()`):
```bash
security delete-keychain "$KEYCHAIN_PATH" 2>/dev/null || true
```

#### Research Insights — tauri-action

- **Version pinning:** No `v1` tag exists. Use `@v0` (latest stable = v0.6.2). The `dev` branch renames parameters (`includeUpdaterJson` → `uploadUpdaterJson`). Pin to `@v0` for stability.
- **`latest.json` merge:** The action downloads existing `latest.json` from the release, merges in the new platform entry, and re-uploads. Safe for single-arch builds; designed for multi-arch matrix.
- **DMG CI behavior:** `TAURI_BUNDLER_DMG_IGNORE_CI` auto-set to `true` — skips DMG background/icon positioning that requires a GUI.
- **Artifact naming:** `{productName}_{version}_{arch}.dmg` — for us: `Acepe_2026.3.15_aarch64.dmg`
- **Keychain interaction:** If `APPLE_CERTIFICATE` env var is set, Tauri CLI creates its OWN temporary keychain during `tauri build`. Since we already set up a keychain for vendor signing, we should NOT set `APPLE_CERTIFICATE` on the tauri-action step — just set `APPLE_SIGNING_IDENTITY` so it uses our existing keychain.

#### Research Insights — CI Signing Pitfalls

| Pitfall | Fix |
|---------|-----|
| `codesign` hangs indefinitely | Always run `set-key-partition-list` — macOS pops a GUI dialog nobody can click in CI |
| Keychain locks mid-build | `set-keychain-settings -lut 21600` (6h timeout) |
| OpenSSL 3.x rejects .p12 | Re-encrypt with `openssl pkcs12` (see Phase 1 export steps) |
| "Item not found in keychain" | Append to search list, don't replace: `$(security list-keychains -d user | tr -d '"')` |

### Phase 3: Update Tauri Updater Config

File: `packages/desktop/src-tauri/tauri.conf.json`

```diff
 "updater": {
   "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
   "endpoints": [
-    "https://bucket-proxy-production.up.railway.app/updates/latest.json"
+    "https://github.com/flazouh/acepe/releases/latest/download/latest.json"
   ]
 }
```

**Important:** This change ships with the NEXT release. All users on the current version still check the old endpoint. See Phase 5 for transition.

#### Research Insights — Updater Endpoint

- The URL `https://github.com/{owner}/{repo}/releases/latest/download/latest.json` auto-resolves to the most recent GitHub Release. The `latest` segment is GitHub magic, not a literal tag.
- Tauri updater makes both HEAD and GET requests to this URL. GitHub serves release assets as direct downloads — no presigned URL redirects (which was the original reason for the bucket-proxy).
- The `latest.json` format is identical to what we already generate. Platform keys: `darwin-aarch64`. URLs inside `latest.json` point to specific release assets: `https://github.com/.../releases/download/v2026.3.15/Acepe.app.tar.gz`
- The `pubkey` stays the same — it's the public half of the `TAURI_SIGNING_PRIVATE_KEY` used for EdDSA updater signatures.

### Phase 4: Create Version Tag Script

Replace the complex `production.ts` with a lightweight version bump + tag script:

File: `scripts/build/src/release.ts` (replaces `production.ts`)

Purpose: Generate next version, update `tauri.conf.json`, commit, and push tag. CI does the rest.

```
1. Generate version (reuse existing date-based logic from production.ts)
   - Query git tags: git tag -l "v{year}.{month}.*"
   - Find max build number, increment by 1
   - Collision detection (same as production.ts)
2. Update tauri.conf.json with new version
3. Commit: "release: v{version}"
4. Create tag: v{version}
5. Push commit + tag → triggers CI workflow
```

This is ~50 lines vs the current ~450 lines in production.ts.

#### Research Insights

- Before the first release from the public repo, create `v2026.3.14` tag on current HEAD so the version sequence continues: `git tag v2026.3.14 && git push origin v2026.3.14`
- The tag push WILL trigger the release workflow — use `releaseDraft: true` for the first test run to verify everything works without publishing.

### Phase 5: Transition Existing Users

**Problem:** Users on v2026.3.14 and earlier check `bucket-proxy-production.up.railway.app/updates/latest.json`. If we kill the proxy, they can never auto-update again.

**Solution — Bridge Release:**

1. Keep bucket-proxy running temporarily
2. First GitHub Release (e.g. v2026.3.15) ships with the new updater endpoint in `tauri.conf.json`
3. Update the S3 `latest.json` ONE LAST TIME to point to the GitHub Release artifacts:
   ```json
   {
     "version": "2026.3.15",
     "pub_date": "2026-03-24T00:00:00Z",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<copy from GitHub Release's .sig file content>",
         "url": "https://github.com/flazouh/acepe/releases/download/v2026.3.15/Acepe.app.tar.gz"
       }
     }
   }
   ```
4. Old users fetch update via bucket-proxy → download from GitHub → install v2026.3.15 → future updates go direct to GitHub
5. After a few weeks, sunset bucket-proxy

#### Research Insights — Transition Safety

- The bridge release's `.app.tar.gz` URL uses the versioned path (`/releases/download/v2026.3.15/...`), not the `/latest/download/` path. This ensures the asset is always available even after newer releases.
- Signature in the S3 `latest.json` must match the `.sig` file from the GitHub Release — copy the EXACT content of `Acepe.app.tar.gz.sig` from the release assets.
- Consider adding the old endpoint as a fallback in `tauri.conf.json` during the transition (Tauri tries endpoints in order):
  ```json
  "endpoints": [
    "https://github.com/flazouh/acepe/releases/latest/download/latest.json",
    "https://bucket-proxy-production.up.railway.app/updates/latest.json"
  ]
  ```
  This way, if GitHub is down, the old proxy still works. Remove the fallback after transition.

### Phase 6: Cleanup

After transition period (~2-4 weeks):
- [ ] Delete `infra/bucket-proxy/` directory
- [ ] Delete `scripts/build/src/production.ts` (replaced by `release.ts`)
- [ ] Remove S3 upload functions from `scripts/build/src/shared.ts`
- [ ] Remove `RAILWAY_BUCKET_*` references
- [ ] Remove `ACEPE_CDN_URL` references
- [ ] Shut down Railway bucket-proxy service
- [ ] Remove fallback endpoint from `tauri.conf.json` (if added)
- [ ] Keep `scripts/build/src/staging.ts` (local staging builds stay as-is)
- [ ] Keep `scripts/build/src/shared.ts` (still needed for staging: `buildACPs`, `signVendorBinaries`, `buildTauri`)

## Acceptance Criteria

- [ ] Pushing a `v*` tag triggers CI build → GitHub Release with DMG + updater artifacts + `latest.json`
- [ ] App built in CI is signed with Developer ID and notarized by Apple
- [ ] Existing users on old updater endpoint can update to the bridge release
- [ ] New installs from GitHub Release DMG work and receive future updates
- [ ] `bun run staging` still works locally for dev testing
- [ ] Version generation preserves `YYYY.MM.BUILD` scheme
- [ ] First release is tested as draft before publishing

## Key Files

| File | Action |
|------|--------|
| `.github/workflows/release.yml` | **Create** — main release CI workflow |
| `scripts/build/src/release.ts` | **Create** — lightweight version bump + tag script |
| `packages/desktop/src-tauri/tauri.conf.json` | **Edit** — change updater endpoint |
| `scripts/build/src/production.ts` | **Delete** (after transition) |
| `infra/bucket-proxy/` | **Delete** (after transition) |
| `scripts/build/src/shared.ts` | **Edit** — remove S3 functions (after transition) |
| `scripts/build/src/staging.ts` | **Keep** — unchanged |

## Dependencies & Risks

- **macOS GitHub Actions runners**: `macos-latest` = `macos-15` arm64 (3 CPUs, 7 GB RAM). Free for public repos. Build + notarize takes ~10-20 min.
- **Apple cert export**: One-time step. Must re-encrypt .p12 for OpenSSL 3.x compatibility. Developer ID certs are valid for 5 years — set a calendar reminder.
- **`tauri-action` version**: Pin to `@v0` (latest stable v0.6.2). No `v1` exists. The `dev` branch renames some parameters.
- **Notarization latency**: Apple's notarization service typically takes 2-5 min but can spike to 15-20 min. The workflow should not set a hard timeout under 30 min.
- **Transition window**: Must keep bucket-proxy alive until most users have updated past the bridge release. ~2-4 weeks should suffice.
- **`latest.json` asset URLs**: Must use versioned path (`/releases/download/v{version}/filename`), not `/releases/latest/download/filename`. The `latest.json` endpoint itself uses `/latest/download/latest.json`.
- **Vendor binary signing order**: ripgrep and claude-agent-acp MUST be signed BEFORE `tauri build` runs, because they get bundled into the .app. This requires manual keychain setup before the tauri-action step.
- **Known codesign hang**: [tauri-action#941](https://github.com/tauri-apps/tauri-action/issues/941) — `codesign` can hang if `set-key-partition-list` is not run. Our manual keychain setup handles this.

## References

- [Tauri v2 Updater Plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri v2 GitHub Actions Pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri v2 macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action) — use `@v0`, not `@v1`
- [Ship Your Tauri v2 App: Code Signing (Part 1)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n)
- [Ship Your Tauri v2 App: GitHub Actions (Part 2)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-github-actions-and-release-automation-part-22-2ef7)
- [Installing Apple cert on macOS runners — GitHub Docs](https://docs.github.com/en/actions/deployment/deploying-xcode-applications/installing-an-apple-certificate-on-macos-runners-for-xcode-development)
- Existing pattern: `.github/workflows/release.yml` (Apple signing in CI)
- Brainstorm: `docs/brainstorms/2026-03-23-github-releases-migration-brainstorm.md`
