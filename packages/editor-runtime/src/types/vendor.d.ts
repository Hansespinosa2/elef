// Durable vendor seams: untyped-at-root runtime dependencies of the editor
// shell. Hosts provide the implementations (Rails via importmap pins, the
// desktop via its own node_modules); these declarations type only the
// surface this package touches. Keep them narrow and explicit.

declare module "@hotwired/stimulus" {
  // Stimulus resolves targets/values/outlets dynamically from static
  // declarations; the index signature types that dynamic surface while the
  // declared members keep the framework-owned surface precise.
  export class Application {
    static start(): Application;
    register(identifier: string, controller: unknown): void;
    getControllerForElementAndIdentifier(element: Element, identifier: string): any;
    handleError(error: unknown, message: string, detail: unknown): void;
    debug: boolean;
    [key: string]: any;
  }

  export class Controller<ElementType extends Element = Element> {
    static targets: string[];
    static values: Record<string, unknown>;
    static classes: string[];
    static outlets: string[];
    readonly element: ElementType;
    readonly identifier: string;
    readonly application: Application;
    connect(): void;
    disconnect(): void;
    [key: string]: any;
  }
}

// NOTE: katex ships its own bundled types (katex/types); no shim needed.

