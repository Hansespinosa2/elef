require "application_system_test_case"

class PythonRenderingTest < ApplicationSystemTestCase
  PYTHON_RUN_BLOCK = <<~MD.chomp
    ```python run
    import matplotlib.pyplot as plt
    import pandas as pd
    import elef

    slope = elef.slider("Slope", min=1, max=3, step=1, value=2)
    plt.plot([0, 1, 2], [0, slope, slope * 2])
    plt.title(f"Slope {slope}")
    plt.show()
    df = pd.DataFrame({"x": [0, 1], "y": [0, slope]})
    print(f"slope={slope}")
    df
    ```
  MD

  PYTHON_SHOW_CODE_BLOCK = <<~MD.chomp
    ```python run show-code
    print("shown code output")
    ```
  MD

  PASSIVE_PYTHON_BLOCK = <<~MD.chomp
    ```python
    passive_value = 42
    ```
  MD

  test "rendered documents and presentations execute python run blocks and scrub slider frames" do
    [
      [Document, ->(work) { document_path(work) }],
      [Presentation, ->(work) { presentation_path(work) }]
    ].each do |work_class, path_for|
      work = work_class.create!(
        title: "Python #{work_class.name}",
        source: "# Analysis\n\n#{PYTHON_RUN_BLOCK}\n\n---\n\n#{PYTHON_SHOW_CODE_BLOCK}\n\n#{PASSIVE_PYTHON_BLOCK}\n"
      )

      visit path_for.call(work)

      assert_selector '.elef-python-block[data-processed="true"] .elef-python-frame:not([hidden]) .elef-python-figures svg', wait: 30
      assert_selector '.elef-python-block[data-processed="true"] .elef-python-frame:not([hidden]) .elef-python-dataframe-wrap table', wait: 30
      assert_selector '.elef-python-block.elef-python-show-code[data-processed="true"] pre.elef-python-code', visible: :all, wait: 30
      assert_text "slope=2"
      assert_selector ".elef-python-block.elef-python-show-code", text: "shown code output", visible: :all, wait: 30
      assert_selector "pre code", text: "passive_value = 42", visible: :all

      page.execute_script(<<~JS)
        (() => {
          const slider = document.querySelector(".elef-python-slider");
          slider.value = "3";
          slider.dispatchEvent(new Event("input", { bubbles: true }));
          slider.dispatchEvent(new Event("change", { bubbles: true }));
        })()
      JS

      assert_text "slope=3"
    end
  end

  test "the editor projection and live preview execute python blocks and expose run controls" do
    document = Document.create!(title: "Python editor", source: "Intro paragraph.\n\n#{PYTHON_RUN_BLOCK}\n")

    visit edit_document_path(document)

    assert_selector '.document-editor-projection .elef-python-block[data-processed="true"] .elef-python-frame:not([hidden]) .elef-python-figures svg', wait: 30

    # Place caret at document start (outside the fence) to see the live preview widget.
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")

    assert_selector ".cm-live-widget-python .elef-python-frame:not([hidden]) .elef-python-figures svg", wait: 30

    # Move caret inside the fence in Source mode to reveal the explicit Run controls widget.
    find('[data-editor-target="sourceButton"]').click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(25, 25)")

    assert_selector ".cm-live-widget-python-controls .elef-python-run-button", wait: 30
  end

  test "a failing python block renders an inline traceback alert" do
    document = Document.create!(
      title: "Python invalid",
      source: "```python run\nraise ValueError('bad input value')\n```\n"
    )

    visit document_path(document)

    assert_selector ".elef-python-block.elef-python-error .elef-python-traceback", wait: 30
    assert_text "ValueError: bad input value"
  end
end
