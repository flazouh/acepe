# Migrate Release Pipeline to GitHub Releases

**Date:** 2026-03-23
**Status:** Ready for planning

## What We're Building

Replace the Railway S3 + bucket-proxy release infrastructure with GitHub Releases. The desktop app release will be fully automated via GitHub Actions CI, triggered by pushing a version tag.

## Why This Approach

- Standard for open-source projects — users expect binaries on GitHub
- Eliminates Railway infra dependency (S3 bucket + bucket-proxy service)
- Community visibility into releases and changelogs
- Tauri has native GitHub Release updater support

## Key Decisions

1. **GitHub Actions CI release** (not local script) — push tag triggers build, sign, notarize, release
2. **Apple Silicon only** (aarch64) — no x86_64 builds
3. **Apple Developer Program available** — can export signing certs for CI
4. **Version scheme unchanged** — keep `YYYY.MM.BUILD` calendar versioning
5. **Tauri updater** — switch endpoint from bucket-proxy to GitHub Release JSON

## What Changes

- `production.ts` → replaced by `.github/workflows/release.yml`
- `shared.ts` S3 upload logic → GitHub Release artifact upload via `gh` or Actions
- `tauri.conf.json` updater endpoint → GitHub Releases URL
- `infra/bucket-proxy/` → can be sunset after migration
- Need to set up GitHub Actions secrets: Apple signing cert (p12), notarization creds, Tauri signing key

## What Stays

- Staging build (`staging.ts`) remains local
- ACP build steps (buildACPs in shared.ts)
- Code signing + notarization flow (just runs in CI instead of locally)
- Version generation logic (date-based from git tags)

## Open Questions

- Transition plan for existing users on the old updater endpoint — may need to keep bucket-proxy alive briefly or do one final S3 release pointing to GitHub
