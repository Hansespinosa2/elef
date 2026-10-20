# Stress: Warnings and unsafe input

The document renderer should remove unsupported directives locally and
report what it removed rather than silently presenting misleading HTML.

:::unknown

Content after an unknown directive remains readable.

:::align{diagonal}

This malformed alignment should produce a warning.

:::align{left

This incomplete directive is another malformed boundary.

[unsafe link](javascript:alert(1))

![unsafe image](javascript:alert(1))

[[Fixture: Missing document]]
