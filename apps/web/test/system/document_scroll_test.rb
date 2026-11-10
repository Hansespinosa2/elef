require "application_system_test_case"

# Repagination must be viewport-transparent: rebuilding the paginated
# surface used to clamp every scroller to the top, so refocusing away
# from a deep edit jumped back to page one. Regression coverage for the
# scroll-preservation restore in document_pages_controller.
class DocumentScrollTest < ApplicationSystemTestCase
  SOURCE = <<~'MARKDOWN'
    ---
    theme: match
    ---
    :::align{center}
    # Deep Learning

    :::align{right}
    ## November 4th
    In Deep learning, we have data, a loss function, a model, and some kind of optimisation that attempts to drive that loss function to its minimum.
    Deep learning generally uses some kind of neural network as the model.
    The neural network sme kind of linear combination of its input.

    $$
    \\mathbf{x} \\in \\mathbb{R} ^n, \\mathbf{w} \\in \\mathbb{R}^n, b \\in \\mathbb{R}
    $$

    $$
    y = \\sigma(\\mathbf{w}^\\top \\mathbf{x} + b)
    $$
    where $\\sigma$ is an activation function of some sort.

    We can compose these $y$ outputs into a vector of outputs $\\mathbf{x}^{(1)} \\in \\mathbb{R}^{n_1}$, with our original input now represented as $\\mathbf{x}^{(n_0)}$.
    We now need to compose the weights multiplied to each input into a series of vectors, hence a matrix, $\\mathbf{W} \\in \\mathbb{R}^{n_1 \\times n_0}$, and we get the following:
    $$
    \\mathbf{x}^{(1)} = \\sigma (\\mathbf{W} \\mathbf{x}^{(0)} + \\mathbf{b})
    $$,
    and by induction
    $$
    \\mathbf{x}^{(k+1)} = \\sigma (\\mathbf{W}^{(k)} \\mathbf{x}^{(k)} + \\mathbf{b}^{(k)} )
    $$
    ### Activation Functions
    Historically, the sigmoid function was used where $\\sigma(x) = \\frac{1}{1+e^{-x}}$.
    The sigmoid function is a smooth version of the heaviside function, which can be seen as an emulation of the way human brains send signals as "on/off".
    $$
    H(x) =
    \\begin{cases}
    1, \\quad & x \\geq 0\\\\
    0, \\quad & x < 0
    \\end{cases}
    $$
    The derivatives of the heaviside function are not informative, so we can use the sigmoid instead.

    Another activation function is $tanh(x) = \\frac{e^x-e^{-x}}{e^x + e^{-x}}$.
    This arctan function can be seen as a rescaling of the sigmoid to be between $-1$ and $1$ instead of $0$ and $1$.

    Practically, the ReLU function is the most used function in deep learning and is $ReLU(x) = \\max(x,0)$.
    It is fast and easy to compute.
    But it does have a problem: neurons that fall below 0 will stay zero in updates because their gradient is completely uninformative.

    Leaky ReLU aims to fix that by adding a small slope to the negativevalues.
    $LReLU(x) = max(x,\\alpha x)$
  MARKDOWN

  def scroll_state
    page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const surface = document.querySelector(".document-editor-projection .document-surface");
        const chain = [];
        let node = surface;
        while (node) {
          if (node.scrollHeight > node.clientHeight + 4) chain.push(node.scrollTop);
          node = node.parentElement;
        }
        return JSON.stringify({ chain, windowY: window.scrollY });
      })()
    JAVASCRIPT
  end

  def paginations
    page.evaluate_script("window.__paginateCount || 0")
  end

  def test_source_edit_preserves_preview_scroll_after_save
    document = Document.create!(title: "Source preview scroll", source: SOURCE)
    visit edit_document_path(document)
    assert_selector ".document-editor-projection .document-surface[data-document-pages-settled='true']", wait: 15
    click_on "Source"
    assert_selector ".document-page-frame", minimum: 2
    before = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const pane = document.querySelector('[data-preview-target="container"]');
        pane.scrollTop = pane.scrollHeight;
        return pane.scrollTop;
      })()
    JAVASCRIPT
    assert_operator before, :>, 200
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.replaceRange('!', editor.sourceValue.length, editor.sourceValue.length);
    JAVASCRIPT
    assert_selector ".document-editor-projection", text: "!", wait: 15
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 15
    until document.reload.source.end_with?("!") || Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
      sleep 0.05
    end
    assert document.reload.source.end_with?("!"), "source edit was not saved"
    assert_selector ".document-editor-projection .document-surface[data-document-pages-settled='true']", wait: 15
    assert_in_delta before, page.evaluate_script("document.querySelector('[data-preview-target=container]').scrollTop"), 120
  end

  def test_delayed_pagination_preserves_position_and_respects_navigation
    document = Document.create!(title: "Delayed preview", source: SOURCE)
    visit edit_document_path(document)
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 15
    click_on "Source"
    before = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const root = document.querySelector('.document-editor-projection');
        const controller = window.Stimulus.getControllerForElementAndIdentifier(root, 'document-pages');
        window.__pagesPrototype = Object.getPrototypeOf(controller);
        window.__resourcesReady = window.__pagesPrototype.resourcesReady;
        window.__pagesPrototype.resourcesReady = () => false;
        const pane = document.querySelector('[data-preview-target="container"]');
        pane.scrollTop = pane.scrollHeight;
        return pane.scrollTop;
      })()
    JAVASCRIPT
    assert_operator before, :>, 200
    page.execute_script(<<~JAVASCRIPT)
      const editor = document.querySelector('.source-field').editorController;
      editor.replaceRange('!', editor.sourceValue.length, editor.sourceValue.length);
    JAVASCRIPT
    assert_selector ".document-surface[data-document-pages-settled='false']", visible: :all, wait: 10
    assert page.evaluate_script(<<~JAVASCRIPT), "pending preview must remain readable without invisible interactive controls"
      (() => {
        const surface = document.querySelector('.document-surface[data-document-pages-settled="false"]');
        const snapshot = document.querySelector('[data-preview-scroll-snapshot]');
        return surface?.hasAttribute('inert') && surface.getAttribute('aria-hidden') === 'true' &&
          snapshot && !snapshot.closest('[inert], [aria-hidden="true"]') &&
          [...snapshot.querySelectorAll('a, button, input, select, textarea, [tabindex]')].every(node => node.tabIndex === -1 && !node.hasAttribute('href'));
      })()
    JAVASCRIPT
    assert_in_delta before, page.evaluate_script("document.querySelector('[data-preview-target=container]').scrollTop"), 5
    moved = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const pane = document.querySelector('[data-preview-target="container"]');
        pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
        pane.scrollTop = 100;
        return pane.scrollTop;
      })()
    JAVASCRIPT
    page.execute_script(<<~JAVASCRIPT)
      window.__pagesPrototype.resourcesReady = window.__resourcesReady;
      const root = document.querySelector('.document-editor-projection');
      window.Stimulus.getControllerForElementAndIdentifier(root, 'document-pages').maybeFirstPass();
    JAVASCRIPT
    assert_no_selector "[data-preview-scroll-snapshot]", visible: :all, wait: 15
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 15
    assert_in_delta moved, page.evaluate_script("document.querySelector('[data-preview-target=container]').scrollTop"), 5
  end

  def test_switching_to_visual_mode_during_delayed_pagination_releases_snapshot
    document = Document.create!(title: "Delayed mode switch", source: SOURCE)
    visit edit_document_path(document)
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 15
    click_on "Source"
    page.execute_script(<<~JAVASCRIPT)
      const root = document.querySelector('.document-editor-projection');
      const controller = window.Stimulus.getControllerForElementAndIdentifier(root, 'document-pages');
      window.__pagesPrototype = Object.getPrototypeOf(controller);
      window.__pagesPrototype.resourcesReady = () => false;
      const editor = document.querySelector('.source-field').editorController;
      editor.replaceRange('!', editor.sourceValue.length, editor.sourceValue.length);
    JAVASCRIPT
    assert_selector "[data-preview-scroll-snapshot]", visible: :all, wait: 10
    click_on "Visual"
    assert_no_selector "[data-preview-scroll-snapshot]", visible: :all
    assert page.evaluate_script("!document.querySelector('.document-editor-projection .document-surface').hasAttribute('inert')")
  end

  def test_blur_released_pagination_preserves_scroll
    document = Document.create!(title: "Scroll preservation", source: SOURCE)
    visit edit_document_path(document)
    assert_selector ".document-editor-projection .document-surface[data-document-pages-settled='true']", wait: 15
    assert_selector ".document-page-frame", minimum: 2
    page.execute_script(<<~JAVASCRIPT)
      window.__paginateCount = 0;
      document.querySelector("form.visual-editor-form").addEventListener("elef:document-paginated", () => { window.__paginateCount += 1; });
    JAVASCRIPT

    page.execute_script("window.scrollTo(0, 5000)")
    sleep 0.5
    target = all(".document-editor-block", text: "Leaky ReLU aims").first
    assert target, "late block not found"
    target.click
    target.send_keys("!")
    sleep 2

    # Blur releases the deferred reflow. The browser's own focus scroll
    # applies synchronously inside blur(), so the baseline below already
    # excludes it: the contract under test is that repagination itself
    # moves no scroller further toward the top.
    page.execute_script("document.activeElement?.blur?.()")
    before = JSON.parse(scroll_state)
    deep = (before["chain"].max || 0) + before["windowY"]
    assert_operator deep, :>, 200, "expected a deep scroll position, got #{before.inspect}"
    assert_selector ".document-editor-projection .document-surface[data-document-pages-settled='true']", wait: 15
    assert_operator paginations, :>=, 1, "expected repagination after blur"

    after = JSON.parse(scroll_state)
    assert_equal before["chain"].length, after["chain"].length, "scroll chain changed shape"
    before["chain"].zip(after["chain"]).each_with_index do |(was, now), index|
      assert_in_delta was, now, 120, "repagination reset scroller #{index} (#{was} -> #{now})"
    end
    assert_in_delta before["windowY"], after["windowY"], 120,
      "repagination reset the window scroll (#{before["windowY"]} -> #{after["windowY"]})"
  end
end
