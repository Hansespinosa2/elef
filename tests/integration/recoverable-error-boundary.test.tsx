// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { RecoverableErrorBoundary, installGlobalErrorReporter } from '../../src/components/RecoverableErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('recoverable error handling', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it('renders recovery UI when a child throws during render', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <RecoverableErrorBoundary>
          <ThrowingChild />
        </RecoverableErrorBoundary>,
      );
    });

    expect(container.querySelector('h1')?.textContent).toBe('Elef needs to recover');
  });

  it('ignores resource errors and abort rejections', () => {
    const onError = vi.fn();
    const cleanup = installGlobalErrorReporter(onError);

    window.dispatchEvent(new ErrorEvent('error', { message: 'asset failed' }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: new DOMException('cancelled', 'AbortError'),
    }));

    expect(onError).not.toHaveBeenCalled();
    cleanup();
  });
});

function ThrowingChild(): never {
  throw new Error('render failed');
}
