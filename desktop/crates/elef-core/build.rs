fn main() {
    println!("cargo:rerun-if-env-changed=ELEF_BUILD_SHA");
    let Ok(build_sha) = std::env::var("ELEF_BUILD_SHA") else {
        return;
    };
    if build_sha.len() == 40 && build_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        println!("cargo:rustc-env=ELEF_BUILD_SHA={build_sha}");
    }
}
