use tauri::Manager;
use crate::commands::observability::{unexpected_command_result, CommandResult};

/// Activates a window by label, bringing it to the foreground.
///
/// Handles all macOS window states: minimized, hidden (Cmd+H), and behind other windows.
/// On macOS, calls NSApplication.activate() to make the app frontmost — Tauri's
/// `set_focus()` alone only reorders within the app's own window stack.
///
/// Each operation is called unconditionally (safe no-ops if already in desired state).
/// Labels that may be activated from the frontend.
const ALLOWED_LABELS: &[&str] = &["main"];

#[tauri::command]
pub fn activate_window(app: tauri::AppHandle, label: String) -> CommandResult<()>  {
    unexpected_command_result("activate_window", "Failed to activate window", (|| {

        if !ALLOWED_LABELS.contains(&label.as_str()) {
            return Err(format!("Window label '{}' is not allowed", label));
        }

        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("Window '{}' not found", label))?;

        // 1. Unminimize (deminiaturize on macOS) — must come before activate
        window.unminimize().map_err(|e| e.to_string())?;
        // 2. Show if hidden
        window.show().map_err(|e| e.to_string())?;

        // 3. macOS: Activate the application (bring to foreground)
        #[cfg(target_os = "macos")]
        {
            use objc2::msg_send;
            use objc2::runtime::{AnyClass, AnyObject};
            unsafe {
                if let Some(ns_app_class) = AnyClass::get(c"NSApplication") {
                    let ns_app: *mut AnyObject = msg_send![ns_app_class, sharedApplication];
                    if !ns_app.is_null() {
                        let _: () = msg_send![ns_app, activateIgnoringOtherApps: true];
                    }
                }
            }
        }

        // 4. Set focus (makeKeyAndOrderFront)
        window.set_focus().map_err(|e| e.to_string())?;

        Ok(())

    })()
    .map_err(|e: String| e))
}
