require "test_helper"
require "fileutils"
require "tmpdir"

# The two Elef work import tasks mutate the database from the command line, so
# a regression in them loses data quietly: a dropped argument resolves to the
# wrong workspace, a missing guard replaces live work, and a broken output line
# tells an operator nothing happened. These tests drive the real rake tasks
# against the scratch test database.
class ElefWorkRakeTest < ActiveSupport::TestCase
  setup do
    @package_directory = Dir.mktmpdir("elef-work-rake")
    @previous_package = ENV["PACKAGE"]
    ENV.delete("PACKAGE")
  end

  teardown do
    FileUtils.remove_entry(@package_directory) if @package_directory && File.directory?(@package_directory)
    if @previous_package.nil?
      ENV.delete("PACKAGE")
    else
      ENV["PACKAGE"] = @previous_package
    end
  end

  def load_tasks_once
    self.class.instance_variable_get(:@elef_work_tasks_loaded) ||
      self.class.instance_variable_set(:@elef_work_tasks_loaded, Rails.application.load_tasks)
  end

  def invoke(name, *arguments)
    load_tasks_once
    task = Rake::Task[name]
    task.reenable
    task.invoke(*arguments)
  end

  def invoke_successfully(name, *arguments)
    invoke(name, *arguments)
  rescue SystemExit => error
    flunk "#{name} exited with status #{error.status} instead of completing"
  end

  def write_package(work, name: "work.zip")
    path = File.join(@package_directory, name)
    File.binwrite(path, WorkPackage::Exporter.call(work, include_revisions: true))
    path
  end

  test "both work import tasks are registered under the work namespace" do
    load_tasks_once

    assert Rake::Task.task_defined?("elef:work:import")
    assert Rake::Task.task_defined?("elef:work:import_legacy")
    assert_equal ["environment"], Rake::Task["elef:work:import"].prerequisites
    assert_equal ["environment"], Rake::Task["elef:work:import_legacy"].prerequisites
    assert_equal [:package], Rake::Task["elef:work:import"].arg_names
  end

  test "aborts with the usage line when no package is given at all" do
    assert_no_difference("Work.count") do
      _out, error = capture_io do
        assert_raises(SystemExit) { invoke("elef:work:import") }
      end

      assert_includes error, "Usage: bin/rails 'elef:work:import[path/to/work.zip]'"
    end
  end

  test "aborts with the usage line when the package argument is blank" do
    ENV["PACKAGE"] = "   "

    assert_no_difference("Work.count") do
      _out, error = capture_io do
        assert_raises(SystemExit) { invoke("elef:work:import", "") }
      end

      assert_includes error, "Usage: bin/rails 'elef:work:import[path/to/work.zip]'"
    end
  end

  test "imports an exported presentation given as the task argument" do
    package = write_package(Presentation.create!(title: "Exported deck", source: "# Exported deck\n\nBody"))

    assert_difference("Work.count", 1) do
      out, = capture_io { invoke_successfully("elef:work:import", package) }
      assert_equal "Imported presentation #{Work.maximum(:id)}: Exported deck\n", out
    end
  end

  test "falls back to the PACKAGE environment variable when no argument is given" do
    ENV["PACKAGE"] = write_package(Presentation.create!(title: "Env deck", source: "# Env deck"))

    assert_difference("Work.count", 1) do
      out, = capture_io { invoke_successfully("elef:work:import") }
      assert_equal "Imported presentation #{Work.maximum(:id)}: Env deck\n", out
    end
  end

  test "prefers the task argument over the PACKAGE environment variable" do
    from_environment = write_package(Presentation.create!(title: "Environment deck", source: "# Environment"), name: "environment.zip")
    from_argument = write_package(Presentation.create!(title: "Argument deck", source: "# Argument"), name: "argument.zip")
    ENV["PACKAGE"] = from_environment

    assert_difference("Work.count", 1) do
      out, = capture_io { invoke_successfully("elef:work:import", from_argument) }
      assert_equal "Imported presentation #{Work.maximum(:id)}: Argument deck\n", out
    end
  end

  test "refuses to import a document over an existing title and leaves no partial work" do
    live = Document.create!(title: "Live document", source: "# Live document")
    package_document = Document.create!(title: "Package document", source: "# Package")
    package = write_package(package_document)
    package_document.destroy!
    live.update!(title: "Package document")

    assert_no_difference("Work.count") do
      error = assert_raises(StandardError) { capture_io { invoke_successfully("elef:work:import", package) } }
      assert_instance_of WorkPackage::ImportConflict, error
      assert_match(/already exists in this workspace/, error.message)
    end

    assert_equal "# Live document", live.reload.source
  end

  test "reports the missing legacy table instead of importing nothing quietly" do
    skip "a legacy presentations table exists right now" if ActiveRecord::Base.connection.data_source_exists?("presentations")

    error = assert_raises(RuntimeError) { capture_io { invoke("elef:work:import_legacy") } }

    assert_match(/legacy presentations table is not available/, error.message)
  end
end
