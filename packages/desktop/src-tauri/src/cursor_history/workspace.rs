//! Cursor workspace utilities.
//!
//! Provides helpers for working with Cursor's project structure.

use super::parser::{get_cursor_home_dir, get_cursor_projects_dir, is_cursor_installed};

/// Check if Cursor is installed on the system.
pub fn check_cursor_installed() -> bool {
    is_cursor_installed()
}

/// Get the Cursor home directory.
pub fn get_home_dir() -> Option<std::path::PathBuf> {
    get_cursor_home_dir().ok()
}

/// Get the Cursor projects directory.
pub fn get_projects_dir() -> Option<std::path::PathBuf> {
    get_cursor_projects_dir().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_cursor_installed() {
        // This test just verifies the function doesn't panic
        let _ = check_cursor_installed();
    }
}
