use crate::commands::observability::{unexpected_command_result, CommandResult};
use tauri::Manager;

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
#[allow(clippy::result_large_err)]
pub fn activate_window(app: tauri::AppHandle, label: String) -> CommandResult<()> {
    unexpected_command_result(
        "activate_window",
        "Failed to activate window",
        (|| {
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
            let _ = window.set_focusable(true);

            // 3. macOS: Activate the application and order the native window front.
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Regular)
                    .map_err(|e| e.to_string())?;

                let (tx, rx) = std::sync::mpsc::channel();
                let window_for_main = window.clone();
                app.run_on_main_thread(move || {
                    let result = activate_macos_window_on_main_thread(&window_for_main);
                    let _ = tx.send(result);
                })
                .map_err(|e| e.to_string())?;
                rx.recv_timeout(std::time::Duration::from_secs(2))
                    .map_err(|_| "Timed out while activating macOS window".to_string())??;
            }

            // 4. Set focus (makeKeyAndOrderFront)
            let was_always_on_top = window.is_always_on_top().unwrap_or(false);
            let _ = window.set_always_on_top(true);
            let focus_result = window.set_focus().map_err(|e| e.to_string());
            if !was_always_on_top {
                let _ = window.set_always_on_top(false);
            }
            focus_result?;

            Ok(())
        })()
        .map_err(|e: String| e),
    )
}

#[cfg(target_os = "macos")]
fn activate_macos_window_on_main_thread(window: &tauri::WebviewWindow) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool};

    unsafe {
        if let Some(ns_app_class) = AnyClass::get(c"NSApplication") {
            let ns_app: *mut AnyObject = msg_send![ns_app_class, sharedApplication];
            if !ns_app.is_null() {
                let _: Bool = msg_send![ns_app, setActivationPolicy: 0isize];
                let _: () = msg_send![ns_app, unhide: std::ptr::null_mut::<AnyObject>()];
                let _: () = msg_send![ns_app, activateIgnoringOtherApps: true];
            }
        }

        if let Some(ns_running_application_class) = AnyClass::get(c"NSRunningApplication") {
            let current_app: *mut AnyObject =
                msg_send![ns_running_application_class, currentApplication];
            if !current_app.is_null() {
                let _: Bool = msg_send![current_app, activateWithOptions: 3usize];
            }
        }

        let ns_window = window.ns_window().map_err(|e| e.to_string())?;
        let ns_window = ns_window as *mut AnyObject;
        if ns_window.is_null() {
            return Err("Native NSWindow pointer is null".to_string());
        }
        let _: () = msg_send![ns_window, setIsVisible: Bool::YES];
        let _: () = msg_send![ns_window, deminiaturize: std::ptr::null_mut::<AnyObject>()];
        let _: () = msg_send![
            ns_window,
            makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()
        ];
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }

    Ok(())
}
