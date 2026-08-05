use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use flate2::read::GzDecoder;
use tokio::fs;
use tokio::sync::Mutex;

use super::indexer::{
    build_manifest_index, manifest_sha256, validate_manifest_index, MAX_MANIFEST_BYTES,
};
use super::lookup::ManifestLookupIndex;
use super::types::ManifestIndex;
use crate::constants::MANIFEST_INDEX_VERSION;

const MANIFEST_CACHE_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const MANIFEST_HTTP_TIMEOUT_SECS: u64 = 30;
const RAW_MANIFEST_FILE_NAME: &str = "cloud-save-manifest.yaml";
const INDEX_FILE_NAME: &str = "cloud-save-manifest-index.json";
const MAX_INDEX_BYTES: u64 = 64 * 1024 * 1024;
const BUNDLED_MANIFEST_GZIP: &[u8] = include_bytes!("baseline-manifest.yaml.gz");
const PINNED_MANIFEST_SHA256: &str = include_str!("baseline-manifest.sha256");

type ManifestCache = Arc<Mutex<Option<Arc<ManifestLookupIndex>>>>;
type ManifestCaches = Mutex<HashMap<PathBuf, ManifestCache>>;

static CACHE_LOCKS: OnceLock<ManifestCaches> = OnceLock::new();
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(MANIFEST_HTTP_TIMEOUT_SECS))
            .build()
            .expect("Failed to build cloud save manifest HTTP client")
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn is_index_expired(index: &ManifestIndex, current_time: i64) -> bool {
    index.fetched_at + MANIFEST_CACHE_TTL_MS <= current_time
}

async fn cache_for(key: PathBuf) -> ManifestCache {
    let caches = CACHE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut caches = caches.lock().await;
    caches
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(None)))
        .clone()
}

fn raw_manifest_path(user_data_path: &Path) -> PathBuf {
    user_data_path.join(RAW_MANIFEST_FILE_NAME)
}

fn index_path(user_data_path: &Path) -> PathBuf {
    user_data_path.join(INDEX_FILE_NAME)
}

async fn read_index(path: &Path) -> Option<ManifestIndex> {
    let content = read_file_bounded(path, MAX_INDEX_BYTES).await?;
    let index: ManifestIndex = serde_json::from_slice(&content).ok()?;
    (index.version == MANIFEST_INDEX_VERSION
        && index.content_sha256 == PINNED_MANIFEST_SHA256.trim()
        && validate_manifest_index(&index).is_ok())
    .then_some(index)
}

async fn read_file_bounded(path: &Path, maximum_bytes: u64) -> Option<Vec<u8>> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(path).ok()?;
        let length = file.metadata().ok()?.len();
        if length == 0 || length > maximum_bytes {
            return None;
        }

        let mut bytes = Vec::with_capacity(length as usize);
        file.take(maximum_bytes + 1).read_to_end(&mut bytes).ok()?;
        (bytes.len() as u64 <= maximum_bytes).then_some(bytes)
    })
    .await
    .ok()
    .flatten()
}

async fn read_utf8_bounded(path: &Path, maximum_bytes: u64) -> Option<String> {
    String::from_utf8(read_file_bounded(path, maximum_bytes).await?).ok()
}

async fn raw_manifest_fetched_at(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).await.ok()?.modified().ok()?;
    Some(
        modified
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    )
}

async fn remove_cache_file(path: &Path) -> Result<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error)
            .with_context(|| format!("Failed to remove stale cache file {}", path.display())),
    }
}

async fn write_atomically(path: &Path, content: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("Invalid manifest cache path: {}", path.display()))?;
    fs::create_dir_all(parent)
        .await
        .with_context(|| format!("Failed to create cache directory {}", parent.display()))?;
    let temp_path = path.with_extension(format!("{}.{}.tmp", std::process::id(), now_ms()));
    if let Err(error) = fs::write(&temp_path, content).await {
        return Err(error).with_context(|| {
            format!(
                "Failed to write temporary cache file {}",
                temp_path.display()
            )
        });
    }
    if let Err(error) = fs::rename(&temp_path, path).await {
        let _ = fs::remove_file(&temp_path).await;
        return Err(error).with_context(|| {
            format!(
                "Failed to replace cache file {} with {}",
                path.display(),
                temp_path.display()
            )
        });
    }
    Ok(())
}

async fn write_index(path: &Path, index: &ManifestIndex) -> Result<()> {
    let content = serde_json::to_vec_pretty(index)
        .with_context(|| format!("Failed to serialize manifest index for {}", path.display()))?;
    if content.is_empty() || content.len() as u64 > MAX_INDEX_BYTES {
        bail!("Cloud save manifest index is outside the allowed size");
    }
    write_atomically(path, &content).await
}

fn verify_manifest_digest(raw_yaml: &str) -> Result<()> {
    if manifest_sha256(raw_yaml) != PINNED_MANIFEST_SHA256.trim() {
        bail!("Cloud save manifest digest does not match this release");
    }
    Ok(())
}

fn bundled_manifest(source_url: &str) -> Result<ManifestIndex> {
    let mut decoder = GzDecoder::new(BUNDLED_MANIFEST_GZIP);
    let mut raw_yaml = String::new();
    decoder
        .by_ref()
        .take((MAX_MANIFEST_BYTES + 1) as u64)
        .read_to_string(&mut raw_yaml)
        .context("Failed to decompress bundled cloud save manifest")?;
    if raw_yaml.is_empty() || raw_yaml.len() > MAX_MANIFEST_BYTES {
        bail!("Bundled cloud save manifest is outside the allowed size");
    }
    verify_manifest_digest(&raw_yaml)?;
    build_manifest_index(&raw_yaml, source_url, now_ms())
}

async fn download_manifest(source_url: &str) -> Result<String> {
    let mut response = http_client()
        .get(source_url)
        .header("User-Agent", "GameHub-Cloud-Saves/2")
        .send()
        .await
        .with_context(|| format!("Failed to download cloud save manifest from {source_url}"))?
        .error_for_status()
        .with_context(|| format!("Cloud save manifest request failed for {source_url}"))?;
    if response
        .content_length()
        .is_some_and(|length| length == 0 || length > MAX_MANIFEST_BYTES as u64)
    {
        bail!("Cloud save manifest response is outside the allowed size");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .with_context(|| format!("Failed to read cloud save manifest body from {source_url}"))?
    {
        if bytes
            .len()
            .checked_add(chunk.len())
            .is_none_or(|length| length > MAX_MANIFEST_BYTES)
        {
            bail!("Cloud save manifest response exceeds the allowed size");
        }
        bytes.extend_from_slice(&chunk);
    }
    let raw_yaml = String::from_utf8(bytes)
        .with_context(|| format!("Cloud save manifest from {source_url} is not UTF-8"))?;
    verify_manifest_digest(&raw_yaml)?;
    Ok(raw_yaml)
}

async fn load_index(user_data_path: &Path, source_url: &str) -> Result<ManifestIndex> {
    let current_time = now_ms();
    let index_file = index_path(user_data_path);
    let raw_file = raw_manifest_path(user_data_path);
    let disk_index = read_index(&index_file).await;
    let has_matching_disk_index = disk_index
        .as_ref()
        .is_some_and(|index| index.source_url == source_url);
    let disk_index = disk_index.filter(|index| index.source_url == source_url);
    let mut fallback = disk_index
        .clone()
        .or_else(|| bundled_manifest(source_url).ok());

    if let Some(index) = &disk_index {
        if !is_index_expired(index, current_time) {
            return Ok(index.clone());
        }
    }

    let raw_yaml = if disk_index.is_some() {
        read_utf8_bounded(&raw_file, MAX_MANIFEST_BYTES as u64)
            .await
            .filter(|raw_yaml| verify_manifest_digest(raw_yaml).is_ok())
    } else {
        None
    };

    if let Some(raw_yaml) = raw_yaml {
        let fetched_at = raw_manifest_fetched_at(&raw_file)
            .await
            .unwrap_or(current_time);
        if let Ok(rebuilt) = build_manifest_index(&raw_yaml, source_url, fetched_at) {
            // A valid rebuilt index remains usable in memory if refreshing disk fails.
            let _ = write_index(&index_file, &rebuilt).await;
            if !is_index_expired(&rebuilt, current_time) {
                return Ok(rebuilt);
            }
            fallback = Some(rebuilt);
        }
    }

    let fresh_result = async {
        let raw_yaml = download_manifest(source_url).await?;
        let fresh = build_manifest_index(&raw_yaml, source_url, now_ms())?;
        if !has_matching_disk_index {
            remove_cache_file(&raw_file).await?;
            remove_cache_file(&index_file).await?;
        }
        write_atomically(&raw_file, raw_yaml.as_bytes()).await?;
        write_index(&index_file, &fresh).await?;
        Ok::<ManifestIndex, anyhow::Error>(fresh)
    }
    .await;

    fresh_result.or_else(|error| fallback.ok_or(error))
}

pub async fn get_manifest_index(
    user_data_path: &Path,
    source_url: &str,
) -> Result<Arc<ManifestLookupIndex>> {
    let cache = cache_for(user_data_path.to_path_buf()).await;
    let mut cached = cache.lock().await;

    if let Some(index) = cached.as_ref() {
        if index.manifest.source_url == source_url && !is_index_expired(&index.manifest, now_ms()) {
            return Ok(Arc::clone(index));
        }
    }

    let fallback = cached
        .as_ref()
        .filter(|index| index.manifest.source_url == source_url)
        .map(Arc::clone);
    let index = load_index(user_data_path, source_url)
        .await
        .map(ManifestLookupIndex::new)
        .map(Arc::new)
        .or_else(|error| fallback.ok_or(error))?;
    *cached = Some(Arc::clone(&index));
    Ok(index)
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;
    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::manifest::types::ManifestGameEntry;

    #[tokio::test]
    async fn rejects_oversized_cache_files_before_reading_them() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("oversized-index.json");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(MAX_INDEX_BYTES + 1)
            .unwrap();

        assert!(read_file_bounded(&path, MAX_INDEX_BYTES).await.is_none());
    }

    #[tokio::test]
    async fn rejects_a_structurally_invalid_cached_index() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("index.json");
        let mut games = IndexMap::new();
        games.insert(
            "Game".to_string(),
            ManifestGameEntry {
                manifest_key: "Different Game".to_string(),
                files: vec![],
            },
        );
        let index = ManifestIndex {
            version: MANIFEST_INDEX_VERSION,
            fetched_at: 0,
            source_url: "test".to_string(),
            content_sha256: PINNED_MANIFEST_SHA256.trim().to_string(),
            games,
        };
        std::fs::write(&path, serde_json::to_vec(&index).unwrap()).unwrap();

        assert!(read_index(&path).await.is_none());
    }
}
