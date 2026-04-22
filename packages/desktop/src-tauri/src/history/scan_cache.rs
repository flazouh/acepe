//! Single-flight + TTL cache for session scan operations.
//!
//! Coalesces concurrent identical scan requests and caches results for 5 seconds
//! to eliminate spawn storms and redundant subprocess invocations.

use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Mutex};

/// Default max cache entries; prevents unbounded memory growth with many project combinations.
const DEFAULT_MAX_ENTRIES: usize = 64;

struct CacheEntry<T> {
    payload: T,
    fetched_at: Instant,
}

/// Cache with single-flight deduplication, TTL semantics, and bounded size.
pub struct ScanCache<T> {
    entries: Mutex<HashMap<String, CacheEntry<T>>>,
    in_flight: Mutex<HashMap<String, broadcast::Sender<Result<T, String>>>>,
    ttl: Duration,
    max_entries: usize,
}

impl<T> ScanCache<T>
where
    T: Clone + Send + 'static,
{
    pub fn new(ttl: Duration) -> Self {
        Self::with_max_entries(ttl, DEFAULT_MAX_ENTRIES)
    }

    /// Create cache with explicit max entries for eviction when over capacity.
    pub fn with_max_entries(ttl: Duration, max_entries: usize) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            in_flight: Mutex::new(HashMap::new()),
            ttl,
            max_entries,
        }
    }

    /// Get from cache if fresh, otherwise fetch. Concurrent identical requests coalesce.
    pub async fn get_or_fetch<F, Fut>(&self, key: String, fetch: F) -> Result<T, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, String>> + Send + 'static,
    {
        let now = Instant::now();

        // Check cache first
        {
            let entries = self.entries.lock().await;
            if let Some(entry) = entries.get(&key) {
                if now.duration_since(entry.fetched_at) <= self.ttl {
                    return Ok(entry.payload.clone());
                }
            }
        }

        // Check if fetch already in progress, or register as fetcher
        let subscribe = {
            let mut in_flight = self.in_flight.lock().await;
            if let Some(tx) = in_flight.get(&key) {
                Some(tx.subscribe())
            } else {
                let (tx, _rx) = broadcast::channel(1);
                in_flight.insert(key.clone(), tx);
                None
            }
        };

        match subscribe {
            Some(mut rx) => {
                // Another fetch is in progress - wait for it
                match rx.recv().await {
                    Ok(result) => result,
                    Err(_) => Err("Channel closed before result received".to_string()),
                }
            }
            None => {
                // We're the fetcher - run fetch in spawned task so panic doesn't orphan waiters
                let fetch_handle = tokio::spawn(fetch());
                let result = match fetch_handle.await {
                    Ok(r) => r,
                    Err(join_err) => {
                        // Fetch task panicked - notify waiters and return error
                        let err_msg = format!("Scan fetch panicked: {join_err}");
                        let tx = {
                            let mut in_flight = self.in_flight.lock().await;
                            in_flight.remove(&key)
                        };
                        if let Some(tx) = tx {
                            let _ = tx.send(Err(err_msg.clone()));
                        }
                        return Err(err_msg);
                    }
                };

                // Store in cache if success, notify waiters (remove from in_flight first so we own tx)
                let key_clone = key.clone();
                let tx = {
                    let mut in_flight = self.in_flight.lock().await;
                    in_flight.remove(&key_clone)
                };
                if let Some(tx) = tx {
                    let _ = tx.send(result.clone());
                }
                if let Ok(ref payload) = &result {
                    let mut entries = self.entries.lock().await;
                    // Evict oldest entry if at capacity
                    if entries.len() >= self.max_entries {
                        let oldest_key = entries
                            .iter()
                            .min_by_key(|(_, e)| e.fetched_at)
                            .map(|(k, _)| k.clone());
                        if let Some(k) = oldest_key {
                            entries.remove(&k);
                        }
                    }
                    entries.insert(
                        key_clone,
                        CacheEntry {
                            payload: payload.clone(),
                            fetched_at: Instant::now(),
                        },
                    );
                }

                result
            }
        }
    }

    pub async fn invalidate(&self) {
        self.entries.lock().await.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn fresh_cache_returns_cached_without_calling_fetch() {
        let cache = ScanCache::new(Duration::from_secs(5));
        let fetch_count = Arc::new(AtomicU32::new(0));

        let result1 = cache
            .get_or_fetch("key".to_string(), {
                let fc = fetch_count.clone();
                move || async move {
                    fc.fetch_add(1, Ordering::SeqCst);
                    Ok(vec!["a".to_string()])
                }
            })
            .await;
        assert_eq!(result1.unwrap(), vec!["a"]);
        assert_eq!(fetch_count.load(Ordering::SeqCst), 1);

        let result2 = cache
            .get_or_fetch("key".to_string(), {
                let fc = fetch_count.clone();
                move || async move {
                    fc.fetch_add(1, Ordering::SeqCst);
                    Ok(vec!["b".to_string()])
                }
            })
            .await;
        assert_eq!(result2.unwrap(), vec!["a"]);
        assert_eq!(fetch_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn stale_cache_triggers_re_fetch() {
        let cache = ScanCache::new(Duration::from_millis(50));
        let fetch_count = Arc::new(AtomicU32::new(0));

        cache
            .get_or_fetch("key".to_string(), {
                let fc = fetch_count.clone();
                move || async move {
                    fc.fetch_add(1, Ordering::SeqCst);
                    Ok(vec!["a".to_string()])
                }
            })
            .await
            .unwrap();
        assert_eq!(fetch_count.load(Ordering::SeqCst), 1);

        tokio::time::sleep(Duration::from_millis(60)).await;

        let result = cache
            .get_or_fetch("key".to_string(), {
                let fc = fetch_count.clone();
                move || async move {
                    fc.fetch_add(1, Ordering::SeqCst);
                    Ok(vec!["b".to_string()])
                }
            })
            .await;
        assert_eq!(result.unwrap(), vec!["b"]);
        assert_eq!(fetch_count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn concurrent_callers_coalesce_into_one_fetch() {
        let cache = Arc::new(ScanCache::new(Duration::from_secs(5)));
        let fetch_count = Arc::new(AtomicU32::new(0));

        let mut handles = Vec::new();
        for _ in 0..20 {
            let cache_clone = cache.clone();
            let fc = fetch_count.clone();
            handles.push(tokio::spawn(async move {
                cache_clone
                    .get_or_fetch("key".to_string(), move || async move {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                        fc.fetch_add(1, Ordering::SeqCst);
                        Ok(42u32)
                    })
                    .await
            }));
        }

        let mut results = Vec::new();
        for h in handles {
            results.push(h.await.unwrap().unwrap());
        }
        assert!(results.iter().all(|&r| r == 42));
        assert_eq!(fetch_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn different_keys_execute_independently() {
        let cache = ScanCache::new(Duration::from_secs(5));

        let (r1, r2) = tokio::join!(
            cache.get_or_fetch("key1".to_string(), || async { Ok("a".to_string()) }),
            cache.get_or_fetch("key2".to_string(), || async { Ok("b".to_string()) }),
        );
        assert_eq!(r1.unwrap(), "a");
        assert_eq!(r2.unwrap(), "b");
    }

    #[tokio::test]
    async fn fetch_failure_does_not_poison_cache() {
        let cache = ScanCache::new(Duration::from_secs(5));
        let attempt = Arc::new(AtomicU32::new(0));

        let err_result = cache
            .get_or_fetch("key".to_string(), {
                let a = attempt.clone();
                move || async move {
                    a.fetch_add(1, Ordering::SeqCst);
                    Err("first attempt failed".to_string())
                }
            })
            .await;
        assert!(err_result.is_err());
        assert_eq!(attempt.load(Ordering::SeqCst), 1);

        let ok_result = cache
            .get_or_fetch("key".to_string(), {
                let a = attempt.clone();
                move || async move {
                    a.fetch_add(1, Ordering::SeqCst);
                    Ok("success".to_string())
                }
            })
            .await;
        assert_eq!(ok_result.unwrap(), "success");
        assert_eq!(attempt.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn fetcher_panic_notifies_waiters() {
        let cache = Arc::new(ScanCache::<String>::new(Duration::from_secs(5)));

        // First caller = fetcher (runs fetch in spawn, fetch panics)
        let cache_fetcher = cache.clone();
        let fetcher_handle = tokio::spawn(async move {
            cache_fetcher
                .get_or_fetch("key".to_string(), || async {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    panic!("intentional panic for test");
                })
                .await
        });

        // Second caller = waiter (subscribes, blocks on recv)
        tokio::time::sleep(Duration::from_millis(5)).await;
        let waiter_result = cache
            .get_or_fetch("key".to_string(), || async {
                panic!("waiter's fetch never runs");
            })
            .await;

        assert!(waiter_result.is_err());
        assert!(waiter_result.unwrap_err().contains("panicked"));

        // Fetcher's get_or_fetch should also return Err (not hang)
        let fetcher_result = tokio::time::timeout(Duration::from_secs(2), fetcher_handle).await;
        assert!(fetcher_result.is_ok(), "Fetcher should complete, not hang");
        let fetcher_result = fetcher_result.unwrap().unwrap();
        assert!(fetcher_result.is_err());
        assert!(fetcher_result.unwrap_err().contains("panicked"));
    }

    #[tokio::test]
    async fn evicts_oldest_when_at_capacity() {
        let cache = ScanCache::with_max_entries(Duration::from_secs(60), 3);

        cache
            .get_or_fetch("a".to_string(), || async { Ok("a".to_string()) })
            .await
            .unwrap();
        cache
            .get_or_fetch("b".to_string(), || async { Ok("b".to_string()) })
            .await
            .unwrap();
        cache
            .get_or_fetch("c".to_string(), || async { Ok("c".to_string()) })
            .await
            .unwrap();

        // Adding "d" should evict "a" (oldest)
        cache
            .get_or_fetch("d".to_string(), || async { Ok("d".to_string()) })
            .await
            .unwrap();

        // "a" should be evicted (cache miss, triggers fetch)
        let fetch_count = Arc::new(AtomicU32::new(0));
        let result = cache
            .get_or_fetch("a".to_string(), {
                let fc = fetch_count.clone();
                move || async move {
                    fc.fetch_add(1, Ordering::SeqCst);
                    Ok("a2".to_string())
                }
            })
            .await;
        assert_eq!(result.unwrap(), "a2");
        assert_eq!(fetch_count.load(Ordering::SeqCst), 1);
    }
}
