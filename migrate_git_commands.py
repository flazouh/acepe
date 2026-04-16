#!/usr/bin/env python3
"""Migrate git Tauri commands from Result<T, String> to CommandResult<T>."""

import re

BASE = "/Users/alex/Documents/acepe/packages/desktop/src-tauri/src"

FILES = [
    f"{BASE}/git/commands.rs",
    f"{BASE}/git/gh_pr.rs",
    f"{BASE}/git/operations.rs",
    f"{BASE}/git/watcher.rs",
    f"{BASE}/git/worktree.rs",
    f"{BASE}/git/worktree_config.rs",
]

MESSAGES = {
    # git/commands.rs
    "git_clone": "Git clone failed",
    "browse_clone_destination": "Failed to browse for clone destination",
    "git_collect_ship_context": "Failed to collect ship context",
    # git/gh_pr.rs
    "git_merge_pr": "Git merge PR failed",
    "git_pr_details": "Failed to fetch PR details",
    "get_open_pr_for_branch": "Failed to get open PR for branch",
    # git/operations.rs
    "git_panel_status": "Failed to get git panel status",
    "git_diff_stats": "Failed to get git diff stats",
    "git_stage_files": "Failed to stage files",
    "git_unstage_files": "Failed to unstage files",
    "git_stage_all": "Failed to stage all files",
    "git_discard_changes": "Failed to discard changes",
    "git_commit": "Git commit failed",
    "git_push": "Git push failed",
    "git_pull": "Git pull failed",
    "git_fetch": "Git fetch failed",
    "git_remote_status": "Failed to get git remote status",
    "git_stash_list": "Failed to list git stash",
    "git_stash_pop": "Failed to pop git stash",
    "git_stash_drop": "Failed to drop git stash",
    "git_stash_save": "Failed to save git stash",
    "git_log": "Failed to get git log",
    "git_create_branch": "Failed to create git branch",
    "git_delete_branch": "Failed to delete git branch",
    "git_run_stacked_action": "Git stacked action failed",
    # git/watcher.rs
    "git_watch_head": "Failed to watch git HEAD",
    # git/worktree.rs
    "git_worktree_create": "Failed to create git worktree",
    "git_prepare_worktree_session_launch": "Failed to prepare worktree session launch",
    "git_discard_prepared_worktree_session_launch": "Failed to discard prepared worktree session launch",
    "git_worktree_remove": "Failed to remove git worktree",
    "git_worktree_rename": "Failed to rename git worktree",
    "git_worktree_reset": "Failed to reset git worktree",
    "git_worktree_list": "Failed to list git worktrees",
    "git_worktree_disk_size": "Failed to get worktree disk size",
    "git_init": "Failed to initialize git repository",
    "git_is_repo": "Failed to check if path is git repository",
    "git_current_branch": "Failed to get current git branch",
    "git_list_branches": "Failed to list git branches",
    "git_checkout_branch": "Failed to checkout git branch",
    "git_has_uncommitted_changes": "Failed to check for uncommitted changes",
    # git/worktree_config.rs
    "load_worktree_config": "Failed to load worktree config",
    "run_worktree_setup": "Failed to run worktree setup",
    "save_worktree_config": "Failed to save worktree config",
}

# Cross-command calls that need .map_err(|e| e.message) added before ?
# Maps fn_name -> list of (old_pattern, new_pattern) to apply inside the body
CROSS_COMMAND_FIXES = {
    "git_collect_ship_context": [
        (
            "crate::git::worktree::git_current_branch(project_path).await?",
            "crate::git::worktree::git_current_branch(project_path).await.map_err(|e| e.message)?",
        ),
    ],
    "get_open_pr_for_branch": [
        (
            "crate::git::worktree::git_current_branch(path.to_string_lossy().into_owned()).await?",
            "crate::git::worktree::git_current_branch(path.to_string_lossy().into_owned()).await.map_err(|e| e.message)?",
        ),
    ],
    "git_run_stacked_action": [
        (
            "crate::git::worktree::git_current_branch(project_path.clone()).await?",
            "crate::git::worktree::git_current_branch(project_path.clone()).await.map_err(|e| e.message)?",
        ),
        (
            "git_remote_status(project_path.clone()).await?",
            "git_remote_status(project_path.clone()).await.map_err(|e| e.message)?",
        ),
    ],
}

IMPORT_LINE = "use crate::commands::observability::{CommandResult, unexpected_command_result};\n"


def find_matching_brace(code, start):
    """Find position of closing brace matching the opening at `start`.

    Handles Rust syntax:
    - String literals "..." with escape sequences
    - Char literals 'x' (single char, detected by looking for closing ')
    - Line comments // ... (skipped to end of line)
    - Block comments /* ... */ (skipped)
    - Raw strings r#"..."# (not handled, but rare in commands)
    - Lifetime annotations 'a, 'static (NOT char literals — detected by context)
    """
    assert code[start] == '{', f"Expected '{{' at {start}, got {code[start]!r}"
    depth = 0
    i = start
    in_string = False
    in_block_comment = False
    escape = False

    while i < len(code):
        c = code[i]

        # Handle escape sequences inside strings
        if escape:
            escape = False
            i += 1
            continue

        # Inside block comment: look for */
        if in_block_comment:
            if c == '*' and i + 1 < len(code) and code[i + 1] == '/':
                in_block_comment = False
                i += 2
            else:
                i += 1
            continue

        # Inside string literal
        if in_string:
            if c == '\\':
                escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue

        # Start of block comment
        if c == '/' and i + 1 < len(code) and code[i + 1] == '*':
            in_block_comment = True
            i += 2
            continue

        # Start of line comment: skip to end of line
        if c == '/' and i + 1 < len(code) and code[i + 1] == '/':
            nl = code.find('\n', i)
            i = nl + 1 if nl != -1 else len(code)
            continue

        # Start of string literal
        if c == '"':
            in_string = True
            i += 1
            continue

        # Char literal or lifetime: 'x' vs 'a (lifetime)
        # A char literal is 'x' or '\n' — the character after ' is followed by '
        # A lifetime is 'name where name starts with a letter and has no closing '
        if c == '\'':
            # Peek ahead to decide if this is a char literal
            j = i + 1
            if j < len(code):
                nc = code[j]
                if nc == '\\':
                    # Escaped char: '\n', '\t', '\'' etc.
                    j += 2  # skip the escaped char
                    if j < len(code) and code[j] == '\'':
                        i = j + 1  # skip closing '
                        continue
                elif nc != '\'' and nc.isalpha() and j + 1 < len(code):
                    # Could be lifetime ('a, 'static) or char literal ('a')
                    # If the char after is ' it's a char literal, else lifetime
                    if code[j + 1] == '\'':
                        # Single-char literal like 'a'
                        i = j + 2
                        continue
                    else:
                        # Lifetime annotation or apostrophe in comment/string
                        i += 1
                        continue
                elif nc == '\'':
                    # Empty char '' — skip
                    i = j + 2 if j + 1 < len(code) else j + 1
                    continue
            i += 1
            continue

        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i

        i += 1

    return -1


def extract_function_body(code, fn_start):
    """Find opening/closing braces and body content."""
    open_brace = code.find('{', fn_start)
    if open_brace == -1:
        return None
    close_brace = find_matching_brace(code, open_brace)
    if close_brace == -1:
        return None
    body = code[open_brace + 1:close_brace]
    return open_brace, close_brace, body


def get_base_indent(fn_start, code):
    """Get indentation of the function's line."""
    line_start = code.rfind('\n', 0, fn_start) + 1
    line = code[line_start:fn_start]
    return len(line) - len(line.lstrip())


def indent_body(body, extra_indent=4):
    """Add extra_indent spaces to each non-empty line."""
    lines = body.split('\n')
    result = []
    for line in lines:
        if line.strip():
            result.append(' ' * extra_indent + line)
        else:
            result.append(line)
    return '\n'.join(result)


def apply_cross_command_fixes(body, fn_name):
    """Apply cross-command call fixes inside the body."""
    fixes = CROSS_COMMAND_FIXES.get(fn_name, [])
    for old, new in fixes:
        if old in body:
            body = body.replace(old, new)
            print(f"    ~ Fixed cross-command call in {fn_name}: ...{old[-40:]}")
        else:
            print(f"    ! WARNING: cross-command fix not found in {fn_name}: {old!r}")
    return body


def add_import(code, filepath):
    """Add import near other use statements if not present."""
    if IMPORT_LINE.strip() in code:
        return code, False

    lines = code.split('\n')
    insert_at = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('use ') or stripped.startswith('//!'):
            insert_at = i + 1
        elif stripped == '' and insert_at > 0:
            continue
        elif insert_at > 0 and not stripped.startswith('use ') and not stripped.startswith('//'):
            break

    lines.insert(insert_at, IMPORT_LINE.rstrip())
    print(f"  + Added import at line {insert_at + 1}")
    return '\n'.join(lines), True


def process_file(filepath):
    with open(filepath, 'r') as f:
        original = f.read()

    code = original
    changed = False

    # Step 1: Add import
    code, import_added = add_import(code, filepath)
    if import_added:
        changed = True

    # Step 2: Find all #[tauri::command] functions (in reverse to preserve positions)
    positions = []
    search_pos = 0
    while True:
        attr_pos = code.find('#[tauri::command]', search_pos)
        if attr_pos == -1:
            break
        positions.append(attr_pos)
        search_pos = attr_pos + 1

    for attr_pos in reversed(positions):
        fn_match = re.search(
            r'pub\s+(?:async\s+)?fn\s+(\w+)',
            code[attr_pos:attr_pos + 600]
        )
        if not fn_match:
            continue

        fn_name = fn_match.group(1)
        is_async = 'async' in fn_match.group(0)
        fn_abs_start = attr_pos + fn_match.start()

        next_open = code.find('{', fn_abs_start)
        if next_open == -1:
            continue
        sig = code[fn_abs_start:next_open]

        # Check for Result<..., String>
        ret_match = re.search(r'->\s*Result<(.+),\s*String\s*>', sig)
        if not ret_match:
            if 'CommandResult' in sig:
                print(f"  - Already migrated: {fn_name}")
            continue

        inner_type = ret_match.group(1).strip()

        if fn_name not in MESSAGES:
            print(f"  ? No message configured for {fn_name}, skipping")
            continue

        message = MESSAGES[fn_name]

        result = extract_function_body(code, fn_abs_start)
        if result is None:
            print(f"  ! Failed to extract body for {fn_name}")
            continue

        open_brace, close_brace, body = result

        # Apply cross-command fixes to body
        body = apply_cross_command_fixes(body, fn_name)

        base_indent = get_base_indent(fn_abs_start, code)
        body_indent = ' ' * (base_indent + 4)

        indented_body = indent_body(body, extra_indent=4)

        if is_async:
            new_body = (
                f' {{\n'
                f'{body_indent}unexpected_command_result("{fn_name}", "{message}", async {{\n'
                f'{indented_body}\n'
                f'{body_indent}}}.await)\n'
                f'{" " * base_indent}}}'
            )
        else:
            new_body = (
                f' {{\n'
                f'{body_indent}unexpected_command_result("{fn_name}", "{message}", {{\n'
                f'{indented_body}\n'
                f'{body_indent}}})\n'
                f'{" " * base_indent}}}'
            )

        # Replace return type in signature
        old_sig = code[fn_abs_start:open_brace]
        new_sig = re.sub(
            r'->\s*Result<(.+?),\s*String\s*>',
            lambda m: f'-> CommandResult<{m.group(1).strip()}>',
            old_sig,
            count=1
        )

        code = code[:fn_abs_start] + new_sig + new_body + code[close_brace + 1:]
        changed = True
        print(f"  + Migrated: {fn_name} -> CommandResult<{inner_type}>")

    if changed:
        with open(filepath, 'w') as f:
            f.write(code)
        print(f"  Wrote: {filepath.split('src/')[-1]}")
    else:
        print(f"  No changes: {filepath.split('src/')[-1]}")

    return changed


def main():
    for filepath in FILES:
        print(f"\nProcessing: {filepath.split('src/')[-1]}")
        process_file(filepath)


if __name__ == '__main__':
    main()
