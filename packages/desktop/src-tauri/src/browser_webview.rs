use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Runtime, Webview, WebviewUrl, Window};

/// State that tracks active browser child webviews by label.
pub struct BrowserWebviewState<R: Runtime> {
    webviews: Mutex<HashMap<String, Webview<R>>>,
}

impl<R: Runtime> Default for BrowserWebviewState<R> {
    fn default() -> Self {
        Self {
            webviews: Mutex::new(HashMap::new()),
        }
    }
}

impl<R: Runtime> BrowserWebviewState<R> {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Create a native child webview inside the main window at the given position/size.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn open_browser_webview<R: Runtime>(
    window: Window<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;

    // Only allow safe URL schemes to prevent local file access via file:// etc.
    let scheme = parsed_url.scheme();
    if !matches!(scheme, "http" | "https" | "about") {
        return Err(format!("Blocked URL scheme: {scheme}"));
    }

    let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(parsed_url));

    let position = tauri::LogicalPosition::new(x, y);
    let size = tauri::LogicalSize::new(w, h);

    let webview = window
        .add_child(builder, position, size)
        .map_err(|e| format!("Failed to create webview: {e}"))?;

    let mut webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    webviews.insert(label.clone(), webview);

    tracing::info!(label = %label, "Browser webview opened");
    Ok(())
}

/// Close and destroy a browser webview.
#[tauri::command]
pub async fn close_browser_webview<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
) -> Result<(), String> {
    let mut webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    if let Some(webview) = webviews.remove(&label) {
        webview
            .close()
            .map_err(|e| format!("Failed to close webview: {e}"))?;
        tracing::info!(label = %label, "Browser webview closed");
    }
    Ok(())
}

/// Reposition and resize a browser webview.
#[tauri::command]
pub async fn resize_browser_webview<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Webview not found: {label}"))?;

    webview
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| format!("Failed to set position: {e}"))?;
    webview
        .set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| format!("Failed to set size: {e}"))?;

    Ok(())
}

/// Navigate a browser webview to a new URL.
#[tauri::command]
pub async fn navigate_browser_webview<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
    url: String,
) -> Result<(), String> {
    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;

    let scheme = parsed_url.scheme();
    if !matches!(scheme, "http" | "https" | "about") {
        return Err(format!("Blocked URL scheme: {scheme}"));
    }

    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Webview not found: {label}"))?;

    webview
        .navigate(parsed_url)
        .map_err(|e| format!("Failed to navigate: {e}"))?;
    Ok(())
}

/// Reload the current page in a browser webview.
#[tauri::command]
pub async fn reload_browser_webview<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Webview not found: {label}"))?;

    webview
        .reload()
        .map_err(|e| format!("Failed to reload: {e}"))?;
    Ok(())
}

/// Navigate back in the browser webview history.
#[tauri::command]
pub async fn browser_webview_back<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Webview not found: {label}"))?;

    webview
        .eval("history.back()")
        .map_err(|e| format!("Failed to go back: {e}"))?;
    Ok(())
}

/// Navigate forward in the browser webview history.
#[tauri::command]
pub async fn browser_webview_forward<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Webview not found: {label}"))?;

    webview
        .eval("history.forward()")
        .map_err(|e| format!("Failed to go forward: {e}"))?;
    Ok(())
}

/// Get the current URL of a browser webview.
#[tauri::command]
pub async fn get_browser_webview_url<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
) -> Result<String, String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Webview not found: {label}"))?;

    let url = webview
        .url()
        .map_err(|e| format!("Failed to get URL: {e}"))?;
    Ok(url.to_string())
}

/// Hide a browser webview (e.g., when panel is not visible).
#[tauri::command]
pub async fn hide_browser_webview<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    if let Some(webview) = webviews.get(&label) {
        webview
            .hide()
            .map_err(|e| format!("Failed to hide webview: {e}"))?;
    }
    Ok(())
}

/// Show a hidden browser webview.
#[tauri::command]
pub async fn show_browser_webview<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, BrowserWebviewState<R>>,
    label: String,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    if let Some(webview) = webviews.get(&label) {
        webview
            .show()
            .map_err(|e| format!("Failed to show webview: {e}"))?;
    }
    Ok(())
}
