/// Disables WebKit's 60fps cap on macOS to allow requestAnimationFrame
/// to run at the display's native refresh rate (e.g. 120fps on ProMotion).
///
/// WKWebView's `PreferPageRenderingUpdatesNear60FPSEnabled` preference defaults
/// to `true`, which caps JS `requestAnimationFrame` to 60fps even on high
/// refresh rate displays. CSS transitions and scrolling are unaffected.
///
/// This uses WebKit's private `_features` API on `WKPreferences` — not App Store
/// safe, but fine for direct distribution via Tauri.
///
/// See: <https://github.com/nicbarker/clay/issues/290>
/// See: <https://github.com/nicbarker/clay/issues/290>
pub fn enable_high_refresh_rate(webview_ptr: *mut std::ffi::c_void) {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
    use objc2::{msg_send, sel};

    unsafe fn responds_to_selector(object: &AnyObject, selector: Sel) -> bool {
        let responds: bool = msg_send![object, respondsToSelector: selector];
        responds
    }

    unsafe {
        let wkwebview = webview_ptr as *const AnyObject;
        if wkwebview.is_null() {
            tracing::warn!("120fps: WKWebView pointer is null");
            return;
        }

        let wkwebview = &*wkwebview;
        if !responds_to_selector(wkwebview, sel!(configuration)) {
            tracing::warn!("120fps: WKWebView does not respond to configuration");
            return;
        }

        // WKWebView → .configuration → .preferences
        let config: Option<Retained<AnyObject>> = msg_send![wkwebview, configuration];
        let Some(config) = config else {
            tracing::warn!("120fps: WKWebView configuration is nil");
            return;
        };
        if !responds_to_selector(&config, sel!(preferences)) {
            tracing::warn!("120fps: WKWebView configuration does not respond to preferences");
            return;
        }

        let prefs: Option<Retained<AnyObject>> = msg_send![&*config, preferences];
        let Some(prefs) = prefs else {
            tracing::warn!("120fps: WKPreferences is nil");
            return;
        };
        if !responds_to_selector(&prefs, sel!(_setEnabled:forFeature:)) {
            tracing::warn!("120fps: WKPreferences does not expose _setEnabled:forFeature:");
            return;
        }

        let prefs_class: *const AnyClass = msg_send![&*prefs, class];
        if prefs_class.is_null() {
            tracing::warn!("120fps: WKPreferences class is null");
            return;
        }
        let prefs_class = &*prefs_class;

        // Newer WebKit builds expose feature lists as class methods, not instance methods.
        let features = if prefs_class.responds_to(sel!(_features)) {
            let features: Option<Retained<AnyObject>> = msg_send![prefs_class, _features];
            features
        } else if prefs_class.responds_to(sel!(_experimentalFeatures)) {
            let features: Option<Retained<AnyObject>> =
                msg_send![prefs_class, _experimentalFeatures];
            features
        } else {
            tracing::warn!(
                "120fps: WKPreferences class does not expose _features or _experimentalFeatures"
            );
            return;
        };
        let Some(features) = features else {
            tracing::warn!("120fps: WKPreferences feature list returned nil");
            return;
        };
        if !responds_to_selector(&features, sel!(count))
            || !responds_to_selector(&features, sel!(objectAtIndex:))
        {
            tracing::warn!("120fps: _features result does not behave like NSArray");
            return;
        }

        let count: usize = msg_send![&*features, count];

        tracing::debug!("120fps: scanning {} WebKit feature flags", count);

        for i in 0..count {
            let feature: Option<Retained<AnyObject>> = msg_send![&*features, objectAtIndex: i];
            let Some(feature) = feature else {
                continue;
            };
            if !responds_to_selector(&feature, sel!(key)) {
                continue;
            }

            let key: Option<Retained<AnyObject>> = msg_send![&*feature, key];
            let Some(key) = key else {
                continue;
            };
            if !responds_to_selector(&key, sel!(UTF8String)) {
                continue;
            }

            let cstr: *const std::os::raw::c_char = msg_send![&*key, UTF8String];
            if cstr.is_null() {
                continue;
            }
            let key_str = std::ffi::CStr::from_ptr(cstr).to_str().unwrap_or("");

            if key_str == "PreferPageRenderingUpdatesNear60FPSEnabled" {
                let _: () = msg_send![&*prefs, _setEnabled: Bool::NO, forFeature: &*feature];
                tracing::info!(
                    "Disabled PreferPageRenderingUpdatesNear60FPSEnabled — \
                     requestAnimationFrame can now run at native refresh rate"
                );
                return;
            }
        }

        tracing::warn!(
            "120fps: PreferPageRenderingUpdatesNear60FPSEnabled not found in {} WebKit feature flags \
             (private API may have changed or macOS version doesn't need this fix)",
            count
        );
    }
}
