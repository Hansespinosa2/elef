use std::path::Path;
use std::process::Command;

fn is_forty_char_hex(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn git_stdout(args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|stdout| stdout.trim().to_owned())
        .filter(|stdout| !stdout.is_empty())
}

fn emit_git_rerun_paths() {
    for rel in ["HEAD", "logs/HEAD", "packed-refs"] {
        if let Some(git_path) = git_stdout(&["rev-parse", "--git-path", rel])
            && Path::new(&git_path).exists()
        {
            println!("cargo:rerun-if-changed={git_path}");
        }
    }
    if let Some(symbolic_ref) = git_stdout(&["symbolic-ref", "-q", "HEAD"])
        && let Some(ref_path) = git_stdout(&["rev-parse", "--git-path", &symbolic_ref])
        && Path::new(&ref_path).exists()
    {
        println!("cargo:rerun-if-changed={ref_path}");
    }
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=ELEF_BUILD_SHA");
    emit_git_rerun_paths();

    if let Some(env_sha) = std::env::var("ELEF_BUILD_SHA")
        .ok()
        .map(|sha| sha.trim().to_ascii_lowercase())
        .filter(|sha| is_forty_char_hex(sha))
    {
        println!("cargo:rustc-env=ELEF_BUILD_SHA={env_sha}");
        return;
    }

    if let Some(git_sha) = git_stdout(&["rev-parse", "HEAD"])
        .map(|sha| sha.to_ascii_lowercase())
        .filter(|sha| is_forty_char_hex(sha))
    {
        println!("cargo:rustc-env=ELEF_BUILD_SHA={git_sha}");
    }
}
