// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0 OR MIT
// Adapted from tauri-plugin-single-instance 2.3.4. Preserve its IPC protocol
// while using maintained zbus 6 on Linux; see adjacent upstream licenses.
use tauri::{AppHandle, Runtime, plugin::TauriPlugin};
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(target_os = "windows")]
use windows as platform;

type SingleInstanceCallback<R> =
    dyn FnMut(&AppHandle<R>, Vec<String>, String) + Send + Sync + 'static;
pub fn init<R: Runtime, F: FnMut(&AppHandle<R>, Vec<String>, String) + Send + Sync + 'static>(
    f: F,
) -> TauriPlugin<R> {
    platform::init(Box::new(f))
}
