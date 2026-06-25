use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};

use async_trait::async_trait;
use libc::{c_long, c_uchar, pid_t};
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject};
use tokio::process::Command;
use tokio::time::{sleep, Duration, Instant};

use super::ids::{computer_element_fingerprint, computer_element_id};
use super::permissions::ComputerPermissionKind;
use super::runtime::ComputerProvider;
use super::types::{
    ComputerActionInput, ComputerActionVerb, ComputerBounds, ComputerError,
    ComputerProviderElement, ComputerProviderEnvironment, ComputerProviderSnapshot,
};

type AXError = i32;
type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;
type CFArrayRef = *const c_void;
type CFBooleanRef = *const c_void;
type CFIndex = c_long;
type CFStringRef = *const c_void;
type CFTypeRef = *const c_void;
type CGEventRef = *const c_void;
type CGEventSourceRef = *const c_void;
type CGKeyCode = u16;

const AX_SUCCESS: AXError = 0;
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const AX_VALUE_CG_POINT_TYPE: i32 = 1;
const AX_VALUE_CG_SIZE_TYPE: i32 = 2;
const MAX_OBSERVED_NODES: usize = 512;
const MAX_TREE_DEPTH: usize = 10;
const CG_HID_EVENT_TAP: u32 = 0;
const CG_SCROLL_EVENT_UNIT_PIXEL: u32 = 0;
const CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
const CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
const CG_EVENT_MOUSE_MOVED: u32 = 5;
const CG_EVENT_LEFT_MOUSE_DRAGGED: u32 = 6;
const CG_MOUSE_BUTTON_LEFT: u32 = 0;
const ACTION_SETTLE_DELAY_MS: u64 = 120;
const INPUT_FOCUS_DELAY_MS: u64 = 80;
const MAX_RETAINED_SCREENSHOTS: usize = 12;

#[repr(C)]
#[derive(Clone, Copy)]
struct CgPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgSize {
    width: f64,
    height: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    #[link_name = "AXIsProcessTrusted"]
    fn ax_is_process_trusted() -> bool;
    #[link_name = "AXUIElementCreateSystemWide"]
    fn ax_ui_element_create_system_wide() -> AXUIElementRef;
    #[link_name = "AXUIElementCreateApplication"]
    fn ax_ui_element_create_application(pid: pid_t) -> AXUIElementRef;
    #[link_name = "AXUIElementCopyAttributeValue"]
    fn ax_ui_element_copy_attribute_value(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    #[link_name = "AXUIElementPerformAction"]
    fn ax_ui_element_perform_action(element: AXUIElementRef, action: CFStringRef) -> AXError;
    #[link_name = "AXUIElementSetAttributeValue"]
    fn ax_ui_element_set_attribute_value(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    #[link_name = "AXValueGetType"]
    fn ax_value_get_type(value: AXValueRef) -> i32;
    #[link_name = "AXValueGetValue"]
    fn ax_value_get_value(value: AXValueRef, value_type: i32, value_ptr: *mut c_void) -> bool;
    #[link_name = "CGEventCreateKeyboardEvent"]
    fn cg_event_create_keyboard_event(
        source: CGEventSourceRef,
        virtual_key: CGKeyCode,
        key_down: bool,
    ) -> CGEventRef;
    #[link_name = "CGEventCreateMouseEvent"]
    fn cg_event_create_mouse_event(
        source: CGEventSourceRef,
        mouse_type: u32,
        mouse_cursor_position: CgPoint,
        mouse_button: u32,
    ) -> CGEventRef;
    #[link_name = "CGEventCreateScrollWheelEvent"]
    fn cg_event_create_scroll_wheel_event(
        source: CGEventSourceRef,
        units: u32,
        wheel_count: u32,
        wheel1: i32,
        wheel2: i32,
    ) -> CGEventRef;
    #[link_name = "CGEventKeyboardSetUnicodeString"]
    fn cg_event_keyboard_set_unicode_string(
        event: CGEventRef,
        string_length: usize,
        unicode_string: *const u16,
    );
    #[link_name = "CGEventSetLocation"]
    fn cg_event_set_location(event: CGEventRef, location: CgPoint);
    #[link_name = "CGEventPost"]
    fn cg_event_post(tap: u32, event: CGEventRef);
    #[link_name = "CGPreflightScreenCaptureAccess"]
    fn cg_preflight_screen_capture_access() -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
    fn CFArrayGetTypeID() -> usize;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: CFIndex) -> *const c_void;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(boolean: CFBooleanRef) -> c_uchar;
    fn CFGetTypeID(value: CFTypeRef) -> usize;
    fn CFRelease(value: CFTypeRef);
    fn CFStringCreateWithCString(
        allocator: CFTypeRef,
        c_string: *const c_char,
        encoding: u32,
    ) -> CFStringRef;
    fn CFStringGetCString(
        string: CFStringRef,
        buffer: *mut c_char,
        buffer_size: CFIndex,
        encoding: u32,
    ) -> bool;
    fn CFStringGetLength(string: CFStringRef) -> CFIndex;
    fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
    fn CFStringGetTypeID() -> usize;
    static kCFBooleanTrue: CFBooleanRef;
}

pub struct MacosComputerProvider {
    revision: AtomicU64,
}

struct OwnedCf(CFTypeRef);

impl Drop for OwnedCf {
    fn drop(&mut self) {
        if self.0.is_null() {
            return;
        }
        unsafe {
            CFRelease(self.0);
        }
    }
}

impl MacosComputerProvider {
    pub fn new() -> Self {
        Self {
            revision: AtomicU64::new(0),
        }
    }
}

impl Default for MacosComputerProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ComputerProvider for MacosComputerProvider {
    async fn environment(&self) -> Result<ComputerProviderEnvironment, ComputerError> {
        ensure_accessibility_permission()?;
        Ok(focused_environment())
    }

    async fn observe(
        &self,
        action: &ComputerActionInput,
    ) -> Result<ComputerProviderSnapshot, ComputerError> {
        self.capture_snapshot(action, Vec::new(), None).await
    }

    async fn act(
        &self,
        action: &ComputerActionInput,
    ) -> Result<ComputerProviderSnapshot, ComputerError> {
        ensure_accessibility_permission()?;
        let baseline_action = snapshot_action_without_media(action);
        let baseline_snapshot = self
            .capture_snapshot(&baseline_action, Vec::new(), None)
            .await?;

        match action.verb {
            ComputerActionVerb::Click => click_target(action)?,
            ComputerActionVerb::Type => type_into_target(action)?,
            ComputerActionVerb::Key => key_into_target(action)?,
            ComputerActionVerb::Scroll => scroll_target(action)?,
            ComputerActionVerb::Drag => drag_target(action)?,
            ComputerActionVerb::Observe => {}
        }

        let settle_start = Instant::now();
        sleep(Duration::from_millis(ACTION_SETTLE_DELAY_MS)).await;
        let settled_ms = u64::try_from(settle_start.elapsed().as_millis()).unwrap_or(u64::MAX);
        let mut snapshot = self
            .capture_snapshot(action, Vec::new(), Some(settled_ms))
            .await?;
        snapshot.changed_fingerprints =
            changed_fingerprints_between(&baseline_snapshot.elements, &snapshot.elements);

        Ok(snapshot)
    }
}

fn snapshot_action_without_media(action: &ComputerActionInput) -> ComputerActionInput {
    let mut snapshot_action = action.clone();
    snapshot_action.include_bounds = false;
    snapshot_action.include_screenshot = false;
    snapshot_action
}

fn changed_fingerprints_between(
    before: &[ComputerProviderElement],
    after: &[ComputerProviderElement],
) -> Vec<String> {
    let before_by_id: HashMap<String, String> = before
        .iter()
        .map(|element| {
            (
                computer_element_id(element),
                computer_element_fingerprint(element),
            )
        })
        .collect();

    after
        .iter()
        .filter_map(|element| {
            let id = computer_element_id(element);
            let fingerprint = computer_element_fingerprint(element);
            match before_by_id.get(&id) {
                Some(before_fingerprint) if before_fingerprint == &fingerprint => None,
                Some(_) | None => Some(fingerprint),
            }
        })
        .collect()
}

impl MacosComputerProvider {
    async fn capture_snapshot(
        &self,
        action: &ComputerActionInput,
        changed_fingerprints: Vec<String>,
        settled_ms: Option<u64>,
    ) -> Result<ComputerProviderSnapshot, ComputerError> {
        ensure_accessibility_permission()?;
        let revision = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
        let screenshot_bounds = focused_window_bounds();
        let screenshot_ref = if action.include_screenshot {
            Some(capture_screenshot_ref(revision, screenshot_bounds.as_ref()).await?)
        } else {
            None
        };

        let mut elements = Vec::new();
        let mut environment = ComputerProviderEnvironment {
            app: None,
            window: None,
            busy: None,
        };
        let system = create_system_wide_element();
        let _system_release = OwnedCf(system);

        if let Some(focused_app) = focused_application_element(system) {
            environment.app = element_label(focused_app.0);
            environment.busy = read_bool_attribute(focused_app.0, "AXBusy");
            if let Some(focused_window) = ax_copy_attribute(focused_app.0, "AXFocusedWindow") {
                environment.window = element_label(focused_window.0);
            }

            let scope_key = environment_scope_key(&environment);
            collect_element_tree(
                focused_app.0,
                0,
                "focused_app",
                scope_key.as_deref(),
                &mut elements,
            );
        }

        Ok(ComputerProviderSnapshot {
            revision,
            settled_ms,
            environment,
            elements,
            changed_fingerprints,
            screenshot_ref,
        })
    }
}

fn focused_environment() -> ComputerProviderEnvironment {
    let system = create_system_wide_element();
    let _system_release = OwnedCf(system);
    let Some(focused_app) = focused_application_element(system) else {
        return ComputerProviderEnvironment {
            app: None,
            window: None,
            busy: None,
        };
    };

    ComputerProviderEnvironment {
        app: element_label(focused_app.0),
        window: ax_copy_attribute(focused_app.0, "AXFocusedWindow")
            .and_then(|focused_window| element_label(focused_window.0)),
        busy: read_bool_attribute(focused_app.0, "AXBusy"),
    }
}

fn focused_application_element(system: AXUIElementRef) -> Option<OwnedCf> {
    ax_copy_attribute(system, "AXFocusedApplication").or_else(|| {
        frontmost_application_pid().and_then(|pid| {
            let element = unsafe { ax_ui_element_create_application(pid) };
            (!element.is_null()).then_some(OwnedCf(element))
        })
    })
}

fn frontmost_application_pid() -> Option<pid_t> {
    unsafe {
        let workspace_class = AnyClass::get(c"NSWorkspace")?;
        let workspace: *mut AnyObject = msg_send![workspace_class, sharedWorkspace];
        if workspace.is_null() {
            return None;
        }

        let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }

        let pid: pid_t = msg_send![app, processIdentifier];
        (pid > 0).then_some(pid)
    }
}

fn environment_scope_key(environment: &ComputerProviderEnvironment) -> Option<String> {
    match (&environment.app, &environment.window) {
        (Some(app), Some(window)) => Some(format!("app:{app}/window:{window}")),
        (Some(app), None) => Some(format!("app:{app}/window:")),
        (None, Some(window)) => Some(format!("app:/window:{window}")),
        (None, None) => None,
    }
}

fn ensure_accessibility_permission() -> Result<(), ComputerError> {
    if unsafe { ax_is_process_trusted() } {
        return Ok(());
    }

    Err(ComputerError::permission_required(
        ComputerPermissionKind::Accessibility,
        "Acepe needs macOS Accessibility permission before it can inspect or control the desktop.",
    ))
}

fn ensure_screen_recording_permission() -> Result<(), ComputerError> {
    if unsafe { cg_preflight_screen_capture_access() } {
        return Ok(());
    }

    Err(ComputerError::permission_required(
        ComputerPermissionKind::ScreenRecording,
        "Acepe needs macOS Screen Recording permission before it can capture screenshots.",
    ))
}

async fn capture_screenshot_ref(
    revision: u64,
    bounds: Option<&ComputerBounds>,
) -> Result<String, ComputerError> {
    ensure_screen_recording_permission()?;

    let path = screenshot_path(revision);
    let Some(parent) = path.parent() else {
        return Err(ComputerError::invalid_input(
            "Could not resolve computer screenshot directory.",
        ));
    };
    tokio::fs::create_dir_all(parent).await.map_err(|error| {
        ComputerError::invalid_input(format!("Could not create screenshot directory: {error}"))
    })?;

    let mut command = Command::new("/usr/sbin/screencapture");
    for argument in screenshot_capture_args(bounds) {
        command.arg(argument);
    }
    let status = command.arg(&path).status().await.map_err(|error| {
        ComputerError::invalid_input(format!("Could not run macOS screenshot capture: {error}"))
    })?;
    if !status.success() {
        return Err(ComputerError::invalid_input(format!(
            "macOS screenshot capture failed with status {status}."
        )));
    }
    let _ = prune_screenshot_dir(parent, MAX_RETAINED_SCREENSHOTS);

    Ok(format!("file://{}", path.to_string_lossy()))
}

fn screenshot_path(revision: u64) -> PathBuf {
    std::env::temp_dir()
        .join("acepe-computer")
        .join(format!("s_{revision}.png"))
}

fn prune_screenshot_dir(dir: &std::path::Path, keep_count: usize) -> io::Result<usize> {
    if keep_count == 0 {
        return Ok(0);
    }

    let mut screenshots = Vec::new();
    for entry_result in fs::read_dir(dir)? {
        let entry = entry_result?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(revision) = screenshot_revision_from_file_name(file_name) else {
            continue;
        };
        screenshots.push((revision, path));
    }

    if screenshots.len() <= keep_count {
        return Ok(0);
    }

    screenshots.sort_by_key(|(revision, _path)| *revision);
    let remove_count = screenshots.len() - keep_count;
    for (_revision, path) in screenshots.into_iter().take(remove_count) {
        fs::remove_file(path)?;
    }

    Ok(remove_count)
}

fn screenshot_revision_from_file_name(file_name: &str) -> Option<u64> {
    file_name
        .strip_prefix("s_")?
        .strip_suffix(".png")?
        .parse()
        .ok()
}

fn screenshot_capture_args(bounds: Option<&ComputerBounds>) -> Vec<String> {
    let mut args = vec!["-x".to_string()];
    if let Some(bounds) = bounds.filter(|bounds| bounds.width > 0 && bounds.height > 0) {
        args.push("-R".to_string());
        args.push(format!(
            "{},{},{},{}",
            bounds.x, bounds.y, bounds.width, bounds.height
        ));
    }
    args
}

fn focused_window_bounds() -> Option<ComputerBounds> {
    let system = create_system_wide_element();
    let _system_release = OwnedCf(system);
    let focused_app = focused_application_element(system)?;
    let focused_window = ax_copy_attribute(focused_app.0, "AXFocusedWindow")?;
    read_bounds(focused_window.0)
}

fn create_system_wide_element() -> AXUIElementRef {
    unsafe { ax_ui_element_create_system_wide() }
}

fn click_target(action: &ComputerActionInput) -> Result<(), ComputerError> {
    let Some(target_id) = action.target_id.as_deref() else {
        return Err(ComputerError::missing_target());
    };

    let system = create_system_wide_element();
    let _system_release = OwnedCf(system);
    let action_name = cf_string("AXPress").ok_or_else(|| {
        ComputerError::invalid_input("Could not create native macOS press action.")
    })?;

    if let Some(focused_app) = focused_application_element(system) {
        let scope_key = environment_scope_key(&focused_environment());
        if press_matching_element(
            focused_app.0,
            target_id,
            action_name.0,
            0,
            "focused_app",
            scope_key.as_deref(),
        ) {
            return Ok(());
        }

        if let Some(focused_window) = ax_copy_attribute(focused_app.0, "AXFocusedWindow") {
            if press_matching_element(
                focused_window.0,
                target_id,
                action_name.0,
                0,
                "focused_window",
                scope_key.as_deref(),
            ) {
                return Ok(());
            }
        }
    }

    let target = find_target_element(target_id).ok_or_else(ComputerError::missing_target)?;
    let bounds = target.bounds.ok_or_else(ComputerError::missing_target)?;
    post_mouse_click(center_point(&bounds))?;

    Ok(())
}

fn type_into_target(action: &ComputerActionInput) -> Result<(), ComputerError> {
    let text = action
        .text
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| ComputerError::invalid_input("type action requires non-empty text."))?;
    focus_action_target(action)?;
    std::thread::sleep(Duration::from_millis(INPUT_FOCUS_DELAY_MS));
    post_unicode_text(text)
}

fn key_into_target(action: &ComputerActionInput) -> Result<(), ComputerError> {
    let key = action
        .key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .ok_or_else(|| ComputerError::invalid_input("key action requires key."))?;
    focus_action_target(action)?;
    post_key(key)
}

fn scroll_target(action: &ComputerActionInput) -> Result<(), ComputerError> {
    let Some(target_id) = action.target_id.as_deref() else {
        return Err(ComputerError::missing_target());
    };
    let delta_x = action.delta_x.unwrap_or(0);
    let delta_y = action.delta_y.unwrap_or(0);
    if delta_x == 0 && delta_y == 0 {
        return Err(ComputerError::invalid_input(
            "scroll action requires delta_x or delta_y.",
        ));
    }
    focus_action_target(action)?;
    let target = find_target_element(target_id).ok_or_else(ComputerError::missing_target)?;
    let bounds = target.bounds.ok_or_else(ComputerError::missing_target)?;
    post_scroll_at(center_point(&bounds), delta_x, delta_y)
}

fn drag_target(action: &ComputerActionInput) -> Result<(), ComputerError> {
    let Some(target_id) = action.target_id.as_deref() else {
        return Err(ComputerError::missing_target());
    };
    let delta_x = action.delta_x.unwrap_or(0);
    let delta_y = action.delta_y.unwrap_or(0);
    if delta_x == 0 && delta_y == 0 {
        return Err(ComputerError::invalid_input(
            "drag action requires delta_x or delta_y.",
        ));
    }

    let target = find_target_element(target_id).ok_or_else(ComputerError::missing_target)?;
    let bounds = target.bounds.ok_or_else(ComputerError::missing_target)?;
    let start = center_point(&bounds);
    post_mouse_drag(
        start,
        CgPoint {
            x: start.x + f64::from(delta_x),
            y: start.y + f64::from(delta_y),
        },
    )
}

fn focus_action_target(action: &ComputerActionInput) -> Result<(), ComputerError> {
    let Some(target_id) = action.target_id.as_deref() else {
        return Err(ComputerError::missing_target());
    };

    if focus_matching_target(target_id) {
        click_target_center_if_available(target_id)?;
        return Ok(());
    }

    click_target_center_if_available(target_id)
}

fn click_target_center_if_available(target_id: &str) -> Result<(), ComputerError> {
    let target = find_target_element(target_id).ok_or_else(ComputerError::missing_target)?;
    let bounds = target.bounds.ok_or_else(ComputerError::missing_target)?;
    post_mouse_click(center_point(&bounds))
}

fn focus_matching_target(target_id: &str) -> bool {
    let system = create_system_wide_element();
    let _system_release = OwnedCf(system);

    if let Some(focused_app) = focused_application_element(system) {
        let scope_key = environment_scope_key(&focused_environment());
        if focus_matching_element(
            focused_app.0,
            target_id,
            0,
            "focused_app",
            scope_key.as_deref(),
        ) {
            return true;
        }

        if let Some(focused_window) = ax_copy_attribute(focused_app.0, "AXFocusedWindow") {
            if focus_matching_element(
                focused_window.0,
                target_id,
                0,
                "focused_window",
                scope_key.as_deref(),
            ) {
                return true;
            }
        }
    }

    false
}

fn press_matching_element(
    element: AXUIElementRef,
    target_id: &str,
    action_name: CFStringRef,
    depth: usize,
    identity_path: &str,
    scope_key: Option<&str>,
) -> bool {
    if let Some(provider_element) = provider_element_from_ax(element, identity_path, scope_key) {
        if computer_element_id(&provider_element) == target_id {
            let error = unsafe { ax_ui_element_perform_action(element, action_name) };
            return error == AX_SUCCESS;
        }
    }

    if depth >= MAX_TREE_DEPTH {
        return false;
    }

    let Some(children) = ax_copy_attribute(element, "AXChildren") else {
        return false;
    };
    if !is_cf_array(children.0) {
        return false;
    }

    let count = unsafe { CFArrayGetCount(children.0 as CFArrayRef) };
    for index in 0..count {
        let child = unsafe { CFArrayGetValueAtIndex(children.0 as CFArrayRef, index) };
        let child_path = child_identity_path(identity_path, index);
        if !child.is_null()
            && press_matching_element(
                child,
                target_id,
                action_name,
                depth + 1,
                &child_path,
                scope_key,
            )
        {
            return true;
        }
    }

    false
}

fn focus_matching_element(
    element: AXUIElementRef,
    target_id: &str,
    depth: usize,
    identity_path: &str,
    scope_key: Option<&str>,
) -> bool {
    if let Some(provider_element) = provider_element_from_ax(element, identity_path, scope_key) {
        if computer_element_id(&provider_element) == target_id {
            let Some(attribute) = cf_string("AXFocused") else {
                return false;
            };
            let error =
                unsafe { ax_ui_element_set_attribute_value(element, attribute.0, kCFBooleanTrue) };
            return error == AX_SUCCESS;
        }
    }

    if depth >= MAX_TREE_DEPTH {
        return false;
    }

    let Some(children) = ax_copy_attribute(element, "AXChildren") else {
        return false;
    };
    if !is_cf_array(children.0) {
        return false;
    }

    let count = unsafe { CFArrayGetCount(children.0 as CFArrayRef) };
    for index in 0..count {
        let child = unsafe { CFArrayGetValueAtIndex(children.0 as CFArrayRef, index) };
        let child_path = child_identity_path(identity_path, index);
        if !child.is_null()
            && focus_matching_element(child, target_id, depth + 1, &child_path, scope_key)
        {
            return true;
        }
    }

    false
}

fn find_target_element(target_id: &str) -> Option<ComputerProviderElement> {
    let system = create_system_wide_element();
    let _system_release = OwnedCf(system);

    let focused_app = focused_application_element(system)?;
    let scope_key = environment_scope_key(&focused_environment());
    find_matching_element(
        focused_app.0,
        target_id,
        0,
        "focused_app",
        scope_key.as_deref(),
    )
    .or_else(|| {
        ax_copy_attribute(focused_app.0, "AXFocusedWindow").and_then(|focused_window| {
            find_matching_element(
                focused_window.0,
                target_id,
                0,
                "focused_window",
                scope_key.as_deref(),
            )
        })
    })
}

fn find_matching_element(
    element: AXUIElementRef,
    target_id: &str,
    depth: usize,
    identity_path: &str,
    scope_key: Option<&str>,
) -> Option<ComputerProviderElement> {
    if let Some(provider_element) = provider_element_from_ax(element, identity_path, scope_key) {
        if computer_element_id(&provider_element) == target_id {
            return Some(provider_element);
        }
    }

    if depth >= MAX_TREE_DEPTH {
        return None;
    }

    let children = ax_copy_attribute(element, "AXChildren")?;
    if !is_cf_array(children.0) {
        return None;
    }

    let count = unsafe { CFArrayGetCount(children.0 as CFArrayRef) };
    for index in 0..count {
        let child = unsafe { CFArrayGetValueAtIndex(children.0 as CFArrayRef, index) };
        if child.is_null() {
            continue;
        }
        let child_path = child_identity_path(identity_path, index);
        if let Some(found) =
            find_matching_element(child, target_id, depth + 1, &child_path, scope_key)
        {
            return Some(found);
        }
    }

    None
}

fn center_point(bounds: &ComputerBounds) -> CgPoint {
    CgPoint {
        x: f64::from(bounds.x) + f64::from(bounds.width) / 2.0,
        y: f64::from(bounds.y) + f64::from(bounds.height) / 2.0,
    }
}

fn post_unicode_text(text: &str) -> Result<(), ComputerError> {
    for character in text.chars() {
        if let Some(key_code) = key_code_for_text_character(character) {
            post_key_code(key_code)?;
            std::thread::sleep(Duration::from_millis(2));
            continue;
        }

        post_unicode_character(character)?;
        std::thread::sleep(Duration::from_millis(2));
    }

    Ok(())
}

fn post_unicode_character(character: char) -> Result<(), ComputerError> {
    let mut buffer = [0_u16; 2];
    for scalar in character.encode_utf16(&mut buffer).iter().copied() {
        let down = unsafe { cg_event_create_keyboard_event(ptr::null(), 0, true) };
        if down.is_null() {
            return Err(ComputerError::invalid_input(
                "Could not create native keyboard event.",
            ));
        }
        let down_release = OwnedCf(down);
        unsafe {
            cg_event_keyboard_set_unicode_string(down, 1, ptr::addr_of!(scalar));
            cg_event_post(CG_HID_EVENT_TAP, down);
        }

        let up = unsafe { cg_event_create_keyboard_event(ptr::null(), 0, false) };
        if up.is_null() {
            return Err(ComputerError::invalid_input(
                "Could not create native keyboard event.",
            ));
        }
        let up_release = OwnedCf(up);
        unsafe {
            cg_event_keyboard_set_unicode_string(up, 1, ptr::addr_of!(scalar));
            cg_event_post(CG_HID_EVENT_TAP, up);
        }
        drop(up_release);
        drop(down_release);
    }

    Ok(())
}

fn post_key(key: &str) -> Result<(), ComputerError> {
    let key_code = key_code_for_name(key)
        .ok_or_else(|| ComputerError::invalid_input(format!("Unsupported key: {key}")))?;
    post_key_code(key_code)
}

fn post_key_code(key_code: CGKeyCode) -> Result<(), ComputerError> {
    let down = unsafe { cg_event_create_keyboard_event(ptr::null(), key_code, true) };
    if down.is_null() {
        return Err(ComputerError::invalid_input(
            "Could not create native key-down event.",
        ));
    }
    let down_release = OwnedCf(down);
    unsafe {
        cg_event_post(CG_HID_EVENT_TAP, down);
    }

    let up = unsafe { cg_event_create_keyboard_event(ptr::null(), key_code, false) };
    if up.is_null() {
        return Err(ComputerError::invalid_input(
            "Could not create native key-up event.",
        ));
    }
    let up_release = OwnedCf(up);
    unsafe {
        cg_event_post(CG_HID_EVENT_TAP, up);
    }
    drop(up_release);
    drop(down_release);

    Ok(())
}

fn post_scroll_at(point: CgPoint, delta_x: i32, delta_y: i32) -> Result<(), ComputerError> {
    post_scroll_event(Some(point), delta_x, delta_y)
}

fn post_scroll_event(
    point: Option<CgPoint>,
    delta_x: i32,
    delta_y: i32,
) -> Result<(), ComputerError> {
    let event = unsafe {
        cg_event_create_scroll_wheel_event(
            ptr::null(),
            CG_SCROLL_EVENT_UNIT_PIXEL,
            2,
            delta_y,
            delta_x,
        )
    };
    if event.is_null() {
        return Err(ComputerError::invalid_input(
            "Could not create native scroll event.",
        ));
    }

    let event_release = OwnedCf(event);
    unsafe {
        if let Some(point) = point {
            cg_event_set_location(event, point);
        }
        cg_event_post(CG_HID_EVENT_TAP, event);
    }
    drop(event_release);

    Ok(())
}

fn post_mouse_click(point: CgPoint) -> Result<(), ComputerError> {
    post_mouse_event(CG_EVENT_LEFT_MOUSE_DOWN, point)?;
    post_mouse_event(CG_EVENT_LEFT_MOUSE_UP, point)
}

fn post_mouse_drag(start: CgPoint, end: CgPoint) -> Result<(), ComputerError> {
    post_mouse_event(CG_EVENT_MOUSE_MOVED, start)?;
    std::thread::sleep(Duration::from_millis(20));
    post_mouse_event(CG_EVENT_LEFT_MOUSE_DOWN, start)?;
    std::thread::sleep(Duration::from_millis(40));
    for step in 1..=16 {
        let progress = f64::from(step) / 16.0;
        post_mouse_event(
            CG_EVENT_LEFT_MOUSE_DRAGGED,
            CgPoint {
                x: start.x + (end.x - start.x) * progress,
                y: start.y + (end.y - start.y) * progress,
            },
        )?;
        std::thread::sleep(Duration::from_millis(16));
    }
    std::thread::sleep(Duration::from_millis(20));
    post_mouse_event(CG_EVENT_LEFT_MOUSE_UP, end)
}

fn post_mouse_event(event_type: u32, point: CgPoint) -> Result<(), ComputerError> {
    let event = unsafe {
        cg_event_create_mouse_event(ptr::null(), event_type, point, CG_MOUSE_BUTTON_LEFT)
    };
    if event.is_null() {
        return Err(ComputerError::invalid_input(
            "Could not create native mouse event.",
        ));
    }

    let event_release = OwnedCf(event);
    unsafe {
        cg_event_post(CG_HID_EVENT_TAP, event);
    }
    drop(event_release);

    Ok(())
}

fn key_code_for_name(key: &str) -> Option<CGKeyCode> {
    match key.to_ascii_lowercase().as_str() {
        "enter" | "return" => Some(36),
        "tab" => Some(48),
        "space" => Some(49),
        "delete" | "backspace" => Some(51),
        "escape" | "esc" => Some(53),
        "arrow_left" | "left" => Some(123),
        "arrow_right" | "right" => Some(124),
        "arrow_down" | "down" => Some(125),
        "arrow_up" | "up" => Some(126),
        _ => None,
    }
}

fn key_code_for_text_character(character: char) -> Option<CGKeyCode> {
    match character.to_ascii_lowercase() {
        'a' => Some(0),
        's' => Some(1),
        'd' => Some(2),
        'f' => Some(3),
        'h' => Some(4),
        'g' => Some(5),
        'z' => Some(6),
        'x' => Some(7),
        'c' => Some(8),
        'v' => Some(9),
        'b' => Some(11),
        'q' => Some(12),
        'w' => Some(13),
        'e' => Some(14),
        'r' => Some(15),
        'y' => Some(16),
        't' => Some(17),
        '1' => Some(18),
        '2' => Some(19),
        '3' => Some(20),
        '4' => Some(21),
        '6' => Some(22),
        '5' => Some(23),
        '=' => Some(24),
        '9' => Some(25),
        '7' => Some(26),
        '-' => Some(27),
        '8' => Some(28),
        '0' => Some(29),
        ']' => Some(30),
        'o' => Some(31),
        'u' => Some(32),
        '[' => Some(33),
        'i' => Some(34),
        'p' => Some(35),
        'l' => Some(37),
        'j' => Some(38),
        '\'' => Some(39),
        'k' => Some(40),
        ';' => Some(41),
        '\\' => Some(42),
        ',' => Some(43),
        '/' => Some(44),
        'n' => Some(45),
        'm' => Some(46),
        '.' => Some(47),
        ' ' => Some(49),
        _ => None,
    }
}

fn collect_element_tree(
    element: AXUIElementRef,
    depth: usize,
    identity_path: &str,
    scope_key: Option<&str>,
    output: &mut Vec<ComputerProviderElement>,
) {
    if output.len() >= MAX_OBSERVED_NODES {
        return;
    }

    if let Some(provider_element) = provider_element_from_ax(element, identity_path, scope_key) {
        output.push(provider_element);
    }

    if depth >= MAX_TREE_DEPTH || output.len() >= MAX_OBSERVED_NODES {
        return;
    }

    let Some(children) = ax_copy_attribute(element, "AXChildren") else {
        return;
    };
    if !is_cf_array(children.0) {
        return;
    }

    let count = unsafe { CFArrayGetCount(children.0 as CFArrayRef) };
    for index in 0..count {
        if output.len() >= MAX_OBSERVED_NODES {
            return;
        }
        let child = unsafe { CFArrayGetValueAtIndex(children.0 as CFArrayRef, index) };
        if !child.is_null() {
            let child_path = child_identity_path(identity_path, index);
            collect_element_tree(child, depth + 1, &child_path, scope_key, output);
        }
    }
}

fn provider_element_from_ax(
    element: AXUIElementRef,
    identity_path: &str,
    scope_key: Option<&str>,
) -> Option<ComputerProviderElement> {
    let role = read_string_attribute(element, "AXRole")
        .map(|role| compact_role(&role))
        .unwrap_or_else(|| "element".to_string());
    let label = element_label_with_fallback(element, &role)?;
    let value = read_string_attribute(element, "AXValue").filter(|value| value != &label);
    let bounds = read_bounds(element);
    let enabled = read_bool_attribute(element, "AXEnabled").unwrap_or(true);
    let focused = read_bool_attribute(element, "AXFocused").unwrap_or(false);
    let native_identifier = read_string_attribute(element, "AXIdentifier");

    Some(ComputerProviderElement {
        scope_key: scope_key.map(str::to_string),
        identity_key: Some(native_identity_key(identity_path, native_identifier)),
        role,
        label,
        value,
        bounds,
        enabled,
        focused,
    })
}

fn child_identity_path(parent: &str, child_index: CFIndex) -> String {
    format!("{parent}/{child_index}")
}

fn native_identity_key(identity_path: &str, native_identifier: Option<String>) -> String {
    native_identifier
        .map(|identifier| identifier.trim().to_string())
        .filter(|identifier| !identifier.is_empty())
        .map(|identifier| format!("ax_identifier:{identifier}"))
        .unwrap_or_else(|| format!("ax_path:{identity_path}"))
}

fn first_non_empty_string(values: &[Option<String>]) -> Option<String> {
    values
        .iter()
        .filter_map(|value| value.as_ref())
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

fn element_label(element: AXUIElementRef) -> Option<String> {
    first_non_empty_string(&[
        read_string_attribute(element, "AXTitle"),
        read_string_attribute(element, "AXDescription"),
        read_string_attribute(element, "AXValue"),
    ])
}

fn element_label_with_fallback(element: AXUIElementRef, fallback: &str) -> Option<String> {
    first_non_empty_string(&[
        read_string_attribute(element, "AXTitle"),
        read_string_attribute(element, "AXDescription"),
        read_string_attribute(element, "AXValue"),
        Some(fallback.to_string()),
    ])
}

fn read_bounds(element: AXUIElementRef) -> Option<ComputerBounds> {
    let position_value = ax_copy_attribute(element, "AXPosition")?;
    let size_value = ax_copy_attribute(element, "AXSize")?;
    let position = ax_value_to_point(position_value.0)?;
    let size = ax_value_to_size(size_value.0)?;

    Some(ComputerBounds {
        x: position.x.round() as i32,
        y: position.y.round() as i32,
        width: size.width.round() as i32,
        height: size.height.round() as i32,
    })
}

fn read_string_attribute(element: AXUIElementRef, attribute: &str) -> Option<String> {
    let value = ax_copy_attribute(element, attribute)?;
    cf_string_to_string(value.0)
}

fn read_bool_attribute(element: AXUIElementRef, attribute: &str) -> Option<bool> {
    let value = ax_copy_attribute(element, attribute)?;
    if !is_cf_boolean(value.0) {
        return None;
    }

    Some(unsafe { CFBooleanGetValue(value.0 as CFBooleanRef) != 0 })
}

fn ax_value_to_point(value: CFTypeRef) -> Option<CgPoint> {
    if unsafe { ax_value_get_type(value as AXValueRef) } != AX_VALUE_CG_POINT_TYPE {
        return None;
    }

    let mut point = CgPoint { x: 0.0, y: 0.0 };
    let ok = unsafe {
        ax_value_get_value(
            value as AXValueRef,
            AX_VALUE_CG_POINT_TYPE,
            ptr::addr_of_mut!(point).cast(),
        )
    };
    ok.then_some(point)
}

fn ax_value_to_size(value: CFTypeRef) -> Option<CgSize> {
    if unsafe { ax_value_get_type(value as AXValueRef) } != AX_VALUE_CG_SIZE_TYPE {
        return None;
    }

    let mut size = CgSize {
        width: 0.0,
        height: 0.0,
    };
    let ok = unsafe {
        ax_value_get_value(
            value as AXValueRef,
            AX_VALUE_CG_SIZE_TYPE,
            ptr::addr_of_mut!(size).cast(),
        )
    };
    ok.then_some(size)
}

fn ax_copy_attribute(element: AXUIElementRef, attribute: &str) -> Option<OwnedCf> {
    let attribute_name = cf_string(attribute)?;
    let mut value = ptr::null();
    let error =
        unsafe { ax_ui_element_copy_attribute_value(element, attribute_name.0, &mut value) };
    if error != AX_SUCCESS || value.is_null() {
        return None;
    }

    Some(OwnedCf(value))
}

fn cf_string(value: &str) -> Option<OwnedCf> {
    let c_string = CString::new(value).ok()?;
    let string = unsafe {
        CFStringCreateWithCString(ptr::null(), c_string.as_ptr(), CF_STRING_ENCODING_UTF8)
    };
    if string.is_null() {
        return None;
    }

    Some(OwnedCf(string))
}

fn cf_string_to_string(value: CFTypeRef) -> Option<String> {
    if !is_cf_string(value) {
        return None;
    }

    let length = unsafe { CFStringGetLength(value as CFStringRef) };
    let max_size =
        unsafe { CFStringGetMaximumSizeForEncoding(length, CF_STRING_ENCODING_UTF8) + 1 };
    if max_size <= 1 {
        return None;
    }

    let mut buffer = vec![0; max_size as usize];
    let ok = unsafe {
        CFStringGetCString(
            value as CFStringRef,
            buffer.as_mut_ptr(),
            max_size,
            CF_STRING_ENCODING_UTF8,
        )
    };
    if !ok {
        return None;
    }

    unsafe { CStr::from_ptr(buffer.as_ptr()) }
        .to_str()
        .ok()
        .map(str::to_string)
}

fn is_cf_array(value: CFTypeRef) -> bool {
    unsafe { CFGetTypeID(value) == CFArrayGetTypeID() }
}

fn is_cf_boolean(value: CFTypeRef) -> bool {
    unsafe { CFGetTypeID(value) == CFBooleanGetTypeID() }
}

fn is_cf_string(value: CFTypeRef) -> bool {
    unsafe { CFGetTypeID(value) == CFStringGetTypeID() }
}

fn compact_role(role: &str) -> String {
    role.strip_prefix("AX")
        .unwrap_or(role)
        .chars()
        .enumerate()
        .fold(String::new(), |mut compact, (index, character)| {
            if character.is_uppercase() && index > 0 {
                compact.push('_');
            }
            compact.push(character.to_ascii_lowercase());
            compact
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observe_action(include_screenshot: bool) -> ComputerActionInput {
        ComputerActionInput {
            verb: ComputerActionVerb::Observe,
            target_id: None,
            epoch: None,
            text: None,
            key: None,
            delta_x: None,
            delta_y: None,
            include_bounds: false,
            include_screenshot,
        }
    }

    #[test]
    fn compact_role_strips_ax_prefix_and_snake_cases() {
        assert_eq!(compact_role("AXButton"), "button");
        assert_eq!(compact_role("AXTextField"), "text_field");
    }

    #[test]
    fn native_identity_key_prefers_trimmed_ax_identifier() {
        assert_eq!(
            native_identity_key("window/0/2", Some("  submit-button  ".to_string())),
            "ax_identifier:submit-button"
        );
    }

    #[test]
    fn native_identity_key_falls_back_to_structural_path() {
        assert_eq!(
            native_identity_key("window/0/2", None),
            "ax_path:window/0/2"
        );
        assert_eq!(
            native_identity_key("window/0/2", Some("  ".to_string())),
            "ax_path:window/0/2"
        );
    }

    #[test]
    fn environment_scope_key_namespaces_by_app_and_window() {
        assert_eq!(
            environment_scope_key(&ComputerProviderEnvironment {
                app: Some("Acepe".to_string()),
                window: Some("Main".to_string()),
                busy: Some(false),
            }),
            Some("app:Acepe/window:Main".to_string())
        );
        assert_eq!(
            environment_scope_key(&ComputerProviderEnvironment {
                app: Some("Safari".to_string()),
                window: None,
                busy: Some(false),
            }),
            Some("app:Safari/window:".to_string())
        );
    }

    #[test]
    fn frontmost_application_pid_is_absent_or_positive() {
        assert!(frontmost_application_pid().is_none_or(|pid| pid > 0));
    }

    #[test]
    fn screenshot_capture_args_crop_to_window_bounds_when_available() {
        assert_eq!(
            screenshot_capture_args(Some(&ComputerBounds {
                x: 10,
                y: 20,
                width: 300,
                height: 200,
            })),
            vec![
                "-x".to_string(),
                "-R".to_string(),
                "10,20,300,200".to_string()
            ]
        );
        assert_eq!(screenshot_capture_args(None), vec!["-x".to_string()]);
    }

    #[test]
    fn screenshot_revision_parser_accepts_only_computer_screenshots() {
        assert_eq!(screenshot_revision_from_file_name("s_42.png"), Some(42));
        assert_eq!(screenshot_revision_from_file_name("s_42.jpg"), None);
        assert_eq!(screenshot_revision_from_file_name("other_42.png"), None);
        assert_eq!(screenshot_revision_from_file_name("s_old.png"), None);
    }

    #[test]
    fn changed_fingerprints_include_new_elements() {
        let before = vec![ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/button".to_string()),
            role: "button".to_string(),
            label: "Run".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        }];
        let added = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/status".to_string()),
            role: "static_text".to_string(),
            label: "Done".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };
        let after = vec![
            ComputerProviderElement {
                scope_key: None,
                identity_key: Some("window/button".to_string()),
                role: "button".to_string(),
                label: "Run".to_string(),
                value: None,
                bounds: None,
                enabled: true,
                focused: false,
            },
            added.clone(),
        ];

        assert_eq!(
            changed_fingerprints_between(&before, &after),
            vec![computer_element_fingerprint(&added)]
        );
    }

    #[test]
    fn prune_screenshot_dir_keeps_latest_revisions_only() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        for revision in 1..=5 {
            fs::write(temp_dir.path().join(format!("s_{revision}.png")), b"png")
                .expect("write screenshot");
        }
        fs::write(temp_dir.path().join("notes.txt"), b"keep").expect("write unrelated");

        let removed = prune_screenshot_dir(temp_dir.path(), 3).expect("prune");

        assert_eq!(removed, 2);
        assert!(!temp_dir.path().join("s_1.png").exists());
        assert!(!temp_dir.path().join("s_2.png").exists());
        assert!(temp_dir.path().join("s_3.png").exists());
        assert!(temp_dir.path().join("s_4.png").exists());
        assert!(temp_dir.path().join("s_5.png").exists());
        assert!(temp_dir.path().join("notes.txt").exists());
    }

    #[tokio::test]
    async fn macos_provider_observe_is_permission_gated_or_native() {
        let provider = MacosComputerProvider::new();
        let result = provider.observe(&observe_action(false)).await;

        match result {
            Ok(snapshot) => {
                assert!(snapshot
                    .elements
                    .iter()
                    .all(|element| element.label != "Run" || element.role != "button"));
            }
            Err(error) => {
                assert_eq!(error.code, "computer_permission_required");
                assert_eq!(
                    error.permission_kind,
                    Some(ComputerPermissionKind::Accessibility)
                );
            }
        }
    }

    #[tokio::test]
    async fn macos_provider_screenshot_request_is_not_silent() {
        let provider = MacosComputerProvider::new();
        let result = provider.observe(&observe_action(true)).await;

        match result {
            Ok(snapshot) => {
                assert!(snapshot
                    .screenshot_ref
                    .as_deref()
                    .is_some_and(|screenshot_ref| screenshot_ref.starts_with("file://")));
            }
            Err(error) => {
                assert!(
                    error.code == "computer_permission_required"
                        || error.code == "invalid_computer_input"
                );
                assert_ne!(error.message, "");
            }
        }
    }

    #[tokio::test]
    async fn macos_provider_observe_advances_revision_when_accessible() {
        let provider = MacosComputerProvider::new();
        let first = provider.observe(&observe_action(false)).await;
        let second = provider.observe(&observe_action(false)).await;

        if let (Ok(first), Ok(second)) = (first, second) {
            assert!(second.revision > first.revision);
        }
    }
}
