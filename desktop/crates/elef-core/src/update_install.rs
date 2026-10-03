//! Activate a fully installed update without making the live launch path disappear.
//! Paths here come from the native shell, never from deck content or IPC arguments.
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

pub struct UpdateStage {
    live: PathBuf,
    directory: tempfile::TempDir,
    staged: PathBuf,
}

impl UpdateStage {
    /// Copy the current installation into a private directory on the same volume.
    /// The updater may freely replace this copy while the live application remains intact.
    pub fn new(live: &Path) -> io::Result<Self> {
        let metadata = fs::symlink_metadata(live)?;
        if metadata.file_type().is_symlink() || !(metadata.is_file() || metadata.is_dir()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid installation",
            ));
        }
        let parent = live.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "Missing installation parent")
        })?;
        let parent = fs::canonicalize(parent)?;
        let live = parent.join(live.file_name().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "Missing installation name")
        })?);
        let mut builder = tempfile::Builder::new();
        builder.prefix(".elef-update-");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(fs::Permissions::from_mode(0o700));
        }
        let directory = builder.tempdir_in(&parent)?;
        let staged = directory.path().join(live.file_name().unwrap());
        copy_tree(&live, &staged)?;
        Ok(Self {
            live,
            directory,
            staged,
        })
    }

    pub fn path(&self) -> &Path {
        &self.staged
    }

    /// Returns the previous installation's location. Keep it until the new app launches.
    /// Unsupported filesystems fail before the live installation is changed.
    pub fn activate(self) -> io::Result<PathBuf> {
        self.activate_with_hook(|_| {})
    }

    fn activate_with_hook(self, mut hook: impl FnMut(&str)) -> io::Result<PathBuf> {
        hook("before_sync");
        let old = fs::symlink_metadata(&self.live)?;
        let new = fs::symlink_metadata(&self.staged)?;
        if old.file_type() != new.file_type() || new.file_type().is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Update installation type changed",
            ));
        }
        sync_tree(&self.staged)?;
        File::open(self.directory.path())?.sync_all()?;
        let parent = File::open(self.live.parent().unwrap())?;
        parent.sync_all()?;
        write_receipt(self.directory.path(), &self.live, &self.staged)?;
        hook("before_exchange");
        exchange(&self.live, &self.staged)?;
        // After exchange, TempDir must never remove the old app. A process kill
        // before or after this point leaves the original launch path intact.
        let previous = self.staged.clone();
        let _ = self.directory.keep();
        hook("after_exchange");
        // The exchange already committed. Report success even if directory sync
        // is unsupported after it; the fully synced replacement is runnable.
        let _ = parent.sync_all();
        Ok(previous)
    }
}

// An update backup is removed only by a launch from the exact replacement
// inode. A receipt is written and flushed before exchange, so a kill cannot
// make an unactivated staging copy look like a successful update.
#[cfg(unix)]
#[derive(serde::Serialize, serde::Deserialize)]
struct Receipt {
    live: PathBuf,
    old_device: u64,
    old_inode: u64,
    new_device: u64,
    new_inode: u64,
}

#[cfg(unix)]
fn write_receipt(directory: &Path, live: &Path, staged: &Path) -> io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::MetadataExt;
    let old = fs::symlink_metadata(live)?;
    let new = fs::symlink_metadata(staged)?;
    let receipt = Receipt {
        live: live.to_owned(),
        old_device: old.dev(),
        old_inode: old.ino(),
        new_device: new.dev(),
        new_inode: new.ino(),
    };
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join("activation.json"))?;
    file.write_all(&serde_json::to_vec(&receipt)?)?;
    file.sync_all()?;
    File::open(directory)?.sync_all()
}

#[cfg(not(unix))]
fn write_receipt(_: &Path, _: &Path, _: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Update receipts unavailable",
    ))
}

/// Best effort housekeeping after a packaged replacement starts successfully.
/// Ignores unmarked, malformed, linked, or identity-mismatched directories.
#[cfg(unix)]
pub fn cleanup_previous_installation(live: &Path) -> io::Result<usize> {
    use std::os::unix::fs::MetadataExt;
    let live_metadata = fs::symlink_metadata(live)?;
    if live_metadata.file_type().is_symlink() {
        return Ok(0);
    }
    let parent = fs::canonicalize(live.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "Missing installation parent")
    })?)?;
    let live =
        parent.join(live.file_name().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "Missing installation name")
        })?);
    let mut removed = 0;
    for entry in fs::read_dir(&parent)? {
        let entry = entry?;
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with(".elef-update-")
        {
            continue;
        }
        let directory = entry.path();
        let metadata = fs::symlink_metadata(&directory)?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || metadata.uid() != live_metadata.uid()
            || metadata.mode() & 0o077 != 0
        {
            continue;
        }
        let receipt_path = directory.join("activation.json");
        let Ok(receipt_metadata) = fs::symlink_metadata(&receipt_path) else {
            continue;
        };
        if !receipt_metadata.is_file()
            || receipt_metadata.file_type().is_symlink()
            || receipt_metadata.len() > 4096
        {
            continue;
        }
        let Ok(bytes) = fs::read(&receipt_path) else {
            continue;
        };
        let Ok(receipt) = serde_json::from_slice::<Receipt>(&bytes) else {
            continue;
        };
        if receipt.live != live
            || receipt.new_device != live_metadata.dev()
            || receipt.new_inode != live_metadata.ino()
        {
            continue;
        }
        let previous = directory.join(live.file_name().unwrap());
        let Ok(previous_metadata) = fs::symlink_metadata(&previous) else {
            continue;
        };
        if previous_metadata.file_type().is_symlink()
            || previous_metadata.dev() != receipt.old_device
            || previous_metadata.ino() != receipt.old_inode
        {
            continue;
        }
        fs::remove_dir_all(directory)?;
        removed += 1;
    }
    Ok(removed)
}

#[cfg(not(unix))]
pub fn cleanup_previous_installation(_: &Path) -> io::Result<usize> {
    Ok(0)
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.is_file() {
        fs::copy(source, destination)?;
    } else if metadata.is_dir() {
        fs::create_dir(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
        }
        fs::set_permissions(destination, metadata.permissions())?;
    } else if metadata.file_type().is_symlink() {
        #[cfg(unix)]
        std::os::unix::fs::symlink(fs::read_link(source)?, destination)?;
        #[cfg(not(unix))]
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Unsupported installation symlink",
        ));
    } else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Special file in installation",
        ));
    }
    Ok(())
}

fn sync_tree(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            sync_tree(&entry?.path())?;
        }
    } else if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Special file in update",
        ));
    }
    File::open(path)?.sync_all()
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn exchange(live: &Path, staged: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let live = CString::new(live.as_os_str().as_bytes())?;
    let staged = CString::new(staged.as_os_str().as_bytes())?;
    // Both paths are owned native paths, NUL terminated and on the same volume.
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            live.as_ptr(),
            libc::AT_FDCWD,
            staged.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renamex_np(live.as_ptr(), staged.as_ptr(), libc::RENAME_SWAP) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn exchange(_: &Path, _: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Atomic update activation unavailable",
    ))
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    fn installation(root: &Path, directory: bool) -> PathBuf {
        let path = root.join(if directory {
            "Elef.app"
        } else {
            "Elef.AppImage"
        });
        if directory {
            fs::create_dir_all(path.join("Contents/MacOS")).unwrap();
            fs::write(path.join("Contents/MacOS/elef"), "old complete app").unwrap();
            std::os::unix::fs::symlink("MacOS/elef", path.join("Contents/current")).unwrap();
        } else {
            fs::write(&path, "old complete app").unwrap();
        }
        path
    }

    fn binary(path: &Path) -> PathBuf {
        if path.is_dir() {
            path.join("Contents/MacOS/elef")
        } else {
            path.to_owned()
        }
    }

    #[test]
    fn activation_retains_the_complete_previous_installation() {
        for directory in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let live = installation(root.path(), directory);
            let stage = UpdateStage::new(&live).unwrap();
            fs::write(binary(stage.path()), "new complete app").unwrap();
            let previous = stage.activate().unwrap();
            assert_eq!(
                fs::read_to_string(binary(&live)).unwrap(),
                "new complete app"
            );
            assert_eq!(
                fs::read_to_string(binary(&previous)).unwrap(),
                "old complete app"
            );
            if directory {
                assert_eq!(
                    fs::read_link(live.join("Contents/current")).unwrap(),
                    Path::new("MacOS/elef")
                );
            }
        }
    }

    #[test]
    fn successful_launch_removes_only_its_identified_backup() {
        for directory in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let live = installation(root.path(), directory);
            let stage = UpdateStage::new(&live).unwrap();
            fs::write(binary(stage.path()), "new complete app").unwrap();
            write_receipt(stage.directory.path(), &stage.live, stage.path()).unwrap();
            assert_eq!(cleanup_previous_installation(&live).unwrap(), 0);
            fs::remove_file(stage.directory.path().join("activation.json")).unwrap();
            let previous = stage.activate().unwrap();
            let unrelated = root.path().join(".elef-update-user-files");
            fs::create_dir(&unrelated).unwrap();
            fs::write(unrelated.join("notes.md"), "user bytes").unwrap();
            let linked = root.path().join(".elef-update-link");
            std::os::unix::fs::symlink(&unrelated, &linked).unwrap();
            assert_eq!(cleanup_previous_installation(&live).unwrap(), 1);
            assert!(!previous.exists());
            assert_eq!(
                fs::read_to_string(binary(&live)).unwrap(),
                "new complete app"
            );
            assert_eq!(
                fs::read_to_string(unrelated.join("notes.md")).unwrap(),
                "user bytes"
            );
            assert!(linked.is_symlink());
            assert_eq!(cleanup_previous_installation(&live).unwrap(), 0);
        }
    }

    #[test]
    fn cleanup_keeps_a_backup_when_the_replacement_identity_changed() {
        let root = tempfile::tempdir().unwrap();
        let live = installation(root.path(), false);
        let stage = UpdateStage::new(&live).unwrap();
        let previous = stage.activate().unwrap();
        let manual = root.path().join("manual-new-version");
        fs::write(&manual, "manual installation").unwrap();
        fs::rename(manual, &live).unwrap();
        assert_eq!(cleanup_previous_installation(&live).unwrap(), 0);
        assert!(previous.exists());
    }

    #[test]
    fn invalid_or_abandoned_staging_never_changes_the_live_app() {
        let root = tempfile::tempdir().unwrap();
        let live = installation(root.path(), false);
        let stage = UpdateStage::new(&live).unwrap();
        let temporary = stage.path().to_owned();
        drop(stage);
        assert!(!temporary.exists());
        let stage = UpdateStage::new(&live).unwrap();
        fs::remove_file(stage.path()).unwrap();
        fs::create_dir(stage.path()).unwrap();
        assert!(stage.activate().is_err());
        assert_eq!(fs::read_to_string(&live).unwrap(), "old complete app");
        let symlink = root.path().join("alias");
        std::os::unix::fs::symlink(&live, &symlink).unwrap();
        assert!(UpdateStage::new(&symlink).is_err());
    }

    #[test]
    fn interrupted_activation_preserves_a_complete_launch_path() {
        for directory in [false, true] {
            for point in [
                "during_staging",
                "before_sync",
                "before_exchange",
                "after_exchange",
            ] {
                for _ in 0..50 {
                    let root = tempfile::tempdir().unwrap();
                    let live = installation(root.path(), directory);
                    let marker = root.path().join("paused");
                    let mut child = Command::new(std::env::current_exe().unwrap())
                        .args([
                            "--exact",
                            "update_install::tests::interrupt_child",
                            "--nocapture",
                        ])
                        .env("ELEF_TEST_UPDATE_LIVE", &live)
                        .env("ELEF_TEST_UPDATE_POINT", point)
                        .env("ELEF_TEST_UPDATE_MARKER", &marker)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                        .unwrap();
                    let deadline = Instant::now() + Duration::from_secs(10);
                    while !marker.exists() {
                        if child.try_wait().unwrap().is_some() || Instant::now() > deadline {
                            let _ = child.kill();
                            let _ = child.wait();
                            panic!("update child did not reach {point}");
                        }
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    child.kill().unwrap();
                    child.wait().unwrap();
                    let expected = if point == "after_exchange" {
                        "new complete app"
                    } else {
                        "old complete app"
                    };
                    assert_eq!(fs::read_to_string(binary(&live)).unwrap(), expected);
                }
            }
        }
    }

    #[test]
    fn interrupt_child() {
        let Some(live) = std::env::var_os("ELEF_TEST_UPDATE_LIVE") else {
            return;
        };
        let point = std::env::var("ELEF_TEST_UPDATE_POINT").unwrap();
        let pause = |name: &str| {
            if name == point {
                fs::write(
                    std::env::var_os("ELEF_TEST_UPDATE_MARKER").unwrap(),
                    "ready",
                )
                .unwrap();
                loop {
                    std::thread::park();
                }
            }
        };
        let stage = UpdateStage::new(Path::new(&live)).unwrap();
        fs::write(binary(stage.path()), "partial").unwrap();
        pause("during_staging");
        fs::write(binary(stage.path()), "new complete app").unwrap();
        stage.activate_with_hook(pause).unwrap();
    }
}
