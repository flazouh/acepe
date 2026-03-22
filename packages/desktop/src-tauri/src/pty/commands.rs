use std::env;

/// Get the user's default shell for the current platform.
///
/// On Unix systems, returns the value of $SHELL environment variable,
/// falling back to /bin/sh if not set.
///
/// On Windows, returns the value of %COMSPEC% environment variable,
/// falling back to cmd.exe if not set.
#[tauri::command]
#[specta::specta]
pub fn get_default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}
