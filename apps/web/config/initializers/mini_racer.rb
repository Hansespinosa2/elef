# Rails may run with Puma workers that fork. Keep V8 single-threaded and create
# contexts lazily in each worker after fork (see Source::JavascriptRenderer).
require "mini_racer"

MiniRacer::Platform.set_flags!(:single_threaded)
