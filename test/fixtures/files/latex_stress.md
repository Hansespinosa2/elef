# LaTeX stress fixture

Inline forms: $\bar{x}$, $\hat{y}$, $\mathbf{z}$, $x_i^2$, $\frac{a+b}{c}$, $\sqrt{1+x^2}$, $\alpha \to \beta$, and $\int_0^1 x\,dx$.

Inline code stays literal: `$x^2$`.

```tex
$x^2$
```

Indented code stays literal:

    $x^2$

Display sum:

$$
\sum_{i=1}^{n} i^2
$$

Aligned display:

$$
\begin{aligned}
f(x) &= \frac{1}{1+x^2} \\
f'(x) &= -\frac{2x}{(1+x^2)^2}
\end{aligned}
$$

Matrix display:

$$
\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
$$
