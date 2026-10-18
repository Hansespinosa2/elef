// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0 OR MIT
// Same bus name, object path and callback protocol as the upstream plugin.
use super::SingleInstanceCallback;
use tauri::{
    AppHandle, Config, Manager, RunEvent, Runtime,
    plugin::{self, TauriPlugin},
};
use zbus::{Connection, connection::Builder, interface};

struct ConnectionHandle(Connection);
struct SingleInstanceDBus<R: Runtime> {
    callback: Box<SingleInstanceCallback<R>>,
    app_handle: AppHandle<R>,
}

#[interface(name = "org.SingleInstance.DBus")]
impl<R: Runtime> SingleInstanceDBus<R> {
    fn execute_callback(&mut self, argv: Vec<String>, cwd: String) {
        (self.callback)(&self.app_handle, argv, cwd);
    }
}

fn dbus_id(config: &Config) -> String {
    config.identifier.replace(['.', '-'], "_")
}

pub fn init<R: Runtime>(callback: Box<SingleInstanceCallback<R>>) -> TauriPlugin<R> {
    plugin::Builder::new("single-instance")
        .setup(|app, _api| {
            let id = dbus_id(app.config());
            let name = format!("org.{id}.SingleInstance");
            let path = format!("/org/{id}/SingleInstance");
            let service = SingleInstanceDBus {
                callback,
                app_handle: app.clone(),
            };
            let result = tauri::async_runtime::block_on(async {
                Builder::session()
                    .name(name.as_str())
                    .replace_existing_names(false)
                    .allow_name_replacements(false)
                    .serve_at(path.as_str(), service)
                    .build()
                    .await
            });
            match result {
                Ok(connection) => {
                    app.manage(ConnectionHandle(connection));
                }
                Err(zbus::Error::NameTaken) => {
                    tauri::async_runtime::block_on(async {
                        if let Ok(connection) = Connection::session().await {
                            let cwd = std::env::current_dir().unwrap_or_default();
                            let _ = connection
                                .call_method(
                                    Some(name.as_str()),
                                    path.as_str(),
                                    Some("org.SingleInstance.DBus"),
                                    "ExecuteCallback",
                                    &(
                                        std::env::args().collect::<Vec<String>>(),
                                        cwd.to_str().unwrap_or_default(),
                                    ),
                                )
                                .await;
                        }
                    });
                    app.cleanup_before_exit();
                    std::process::exit(0);
                }
                Err(error) => return Err(error.into()),
            }
            Ok(())
        })
        .on_event(|app, event| {
            if let RunEvent::Exit = event
                && let Some(connection) = app.try_state::<ConnectionHandle>()
            {
                let name = format!("org.{}.SingleInstance", dbus_id(app.config()));
                let _ = tauri::async_runtime::block_on(connection.0.release_name(name));
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_wire_format_matches_existing_instances() {
        let config = Config {
            identifier: "com.elef.desktop-dev".into(),
            ..Default::default()
        };
        let id = dbus_id(&config);
        assert_eq!(id, "com_elef_desktop_dev");
        let name = format!("org.{id}.SingleInstance");
        let path = format!("/org/{id}/SingleInstance");
        let argv = vec!["elef".to_string(), "notes/été.elef".to_string()];
        let cwd = "/tmp/author's library".to_string();
        let message = zbus::message::Message::method_call(path.as_str(), "ExecuteCallback")
            .destination(name.as_str())
            .interface("org.SingleInstance.DBus")
            .build(&(argv.clone(), cwd.clone()))
            .expect("encode the upstream callback protocol");
        assert_eq!(message.body().signature().to_string_no_parens(), "ass");
        let decoded: (Vec<String>, String) = message.body().deserialize().expect("decode callback");
        assert_eq!(decoded, (argv, cwd));
    }
}
