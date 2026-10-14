ENV["RAILS_ENV"] = "test"
require_relative "../../config/environment"

renderer = Source::JavascriptRenderer
raise "preload failed" unless renderer.render("# Master").include?("<h1>Master</h1>")
preload_context = renderer.context
renderer.dispose_contexts_before_fork
raise "master retained a context" if Thread.current.thread_variable_get(renderer::CONTEXT_KEY)

workers = 2.times.map do |worker|
  fork do
    begin
      threads = 3.times.map do |thread|
        Thread.new do
          5.times do |iteration|
            source = "# Worker #{worker}, thread #{thread}, render #{iteration}\n\n$x^2$\n"
            output = renderer.editor_preview(source, kind: :presentation, title: "Worker")
            raise "worker output mismatch" unless output[:html].include?("<h1>Worker #{worker}, thread #{thread}, render #{iteration}</h1>")
            raise "worker inherited master context" if preload_context.equal?(renderer.context)
          end
        end
      end
      threads.each(&:value)
      exit! 0
    rescue Exception => error
      warn "#{error.class}: #{error.message}"
      exit! 1
    end
  end
end
workers.each do |worker|
  _, status = Process.wait2(worker)
  raise "renderer worker failed: #{status}" unless status.success?
end
raise "master could not resume rendering" unless renderer.render("# Resumed").include?("<h1>Resumed</h1>")
puts "renderer worker fork probe passed"
