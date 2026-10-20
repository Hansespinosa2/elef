---
theme: light
typography: modern
---
# Fixture: mathematical derivations

A dense mathematical notebook with matrices, multiline derivations, and nested expressions for rendering benchmarks.

### D1: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 4 \pmod{3} \\ x &\equiv \pm r \pmod{3} \\ N &= 1 + \left(\frac{4}{3}\right)
\end{aligned}$$

$$\begin{pmatrix} 4 & 1 \\ 0 & 3 \end{pmatrix}$$

The Legendre symbol $\left(\frac{4}{3}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\det\left(I_{27} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $f(x) = x^{2} + 27x + 3$ with $n = 27$.

### D2: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{7 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 7+\kappa & -\kappa \\ -\kappa & 7+\kappa \end{bmatrix}$$

With $\kappa = 7$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 35$ cycles.

$$\binom{35+4}{35} = \frac{(35+4)!}{35! \, 4!}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 35$.

### D3: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 4 & 4 \\ 4 & 1 \end{vmatrix} = 41 - 44$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 13$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\binom{13+15}{13} = \frac{(13+15)!}{13! \, 15!}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 13$.

### D4: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}2 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_2 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-48} & \cdots & c_{0} & \cdots & c_{48} \end{matrix}$$

Gibbs overshoot approaches 24 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $e^{i\pi} + 1 = 0$ and $T(n) = 2 T\left(\frac48{2}\right) + \Theta(n)$ with $n = 48$.

### D5: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_47 &= (1-\rho)\rho^47, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_47 = \lambda & n \geq 0 \\ \mu_47 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.31$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\binom{47+31}{47} = \frac{(47+31)!}{47! \, 31!}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $e^{i\pi} + 1 = 0$ with $n = 47$.

### D6: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{32} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 4 & 8 & 0 \\ 1 & 1 & 8 \\ 0 & 9 & 4 \end{pmatrix}$$

Strict diagonal dominance with $N = 32$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\binom{32+5}{32} = \frac{(32+5)!}{32! \, 5!}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $T(n) = 2 T\left(\frac32{2}\right) + \Theta(n)$ with $n = 32$.

### D7: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 2 \pmod{4} \\ x &\equiv \pm r \pmod{4} \\ N &= 1 + \left(\frac{2}{4}\right)
\end{aligned}$$

$$\begin{pmatrix} 2 & 1 \\ 0 & 4 \end{pmatrix}$$

The Legendre symbol $\left(\frac{2}{4}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\left\| \sum_{k=1}^{34} \frac{A^2}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{34+1}}{(34+1)!} e^{\lVert A \rVert}$$

A quick check uses $E = mc^{2}$ and $T(n) = 2 T\left(\frac34{2}\right) + \Theta(n)$ with $n = 34$.

### D8: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{8 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 8+\kappa & -\kappa \\ -\kappa & 8+\kappa \end{bmatrix}$$

With $\kappa = 8$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 15$ cycles.

$$\binom{15+27}{15} = \frac{(15+27)!}{15! \, 27!}$$

A quick check uses $E = mc^{2}$ and $E = mc^{2}$ with $n = 15$.

### D9: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 1 & 8 \\ 8 & 8 \end{vmatrix} = 18 - 88$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 42$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\left\| \sum_{k=1}^{42} \frac{A^5}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{42+1}}{(42+1)!} e^{\lVert A \rVert}$$

A quick check uses $T(n) = 2 T\left(\frac42{2}\right) + \Theta(n)$ and $T(n) = 2 T\left(\frac42{2}\right) + \Theta(n)$ with $n = 42$.

### D10: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}2 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_2 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-26} & \cdots & c_{0} & \cdots & c_{26} \end{matrix}$$

Gibbs overshoot approaches 38 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\frac9{dx} \left[ \int_{0}^{x^{2}} e^{-38t^{2}} \, dt \right] = 2x e^{-38x^{4}}$$

A quick check uses $T(n) = 2 T\left(\frac26{2}\right) + \Theta(n)$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 26$.

### D11: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_23 &= (1-\rho)\rho^23, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_23 = \lambda & n \geq 0 \\ \mu_23 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.29$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\binom{23+29}{23} = \frac{(23+29)!}{23! \, 29!}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 23$.

### D12: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{5} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 6 & 9 & 0 \\ 3 & 3 & 3 \\ 0 & 1 & 6 \end{pmatrix}$$

Strict diagonal dominance with $N = 5$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\frac3{dx} \left[ \int_{0}^{x^{2}} e^{-40t^{2}} \, dt \right] = 2x e^{-40x^{4}}$$

A quick check uses $a_{n+1} = a_5 + d$ and $e^{i\pi} + 1 = 0$ with $n = 5$.

### D13: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 5 \pmod{15} \\ x &\equiv \pm r \pmod{15} \\ N &= 1 + \left(\frac{5}{15}\right)
\end{aligned}$$

$$\begin{pmatrix} 5 & 1 \\ 0 & 15 \end{pmatrix}$$

The Legendre symbol $\left(\frac{5}{15}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{15}} = \left(1 - 2^{1-15}\right) \zeta(15)$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $a_{n+1} = a_5 + d$ with $n = 5$.

### D14: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{6 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 6+\kappa & -\kappa \\ -\kappa & 6+\kappa \end{bmatrix}$$

With $\kappa = 6$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 30$ cycles.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{35}} = \left(1 - 2^{1-35}\right) \zeta(35)$$

A quick check uses $f(x) = x^{2} + 30x + 35$ and $f(x) = x^{2} + 30x + 35$ with $n = 30$.

### D15: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 5 & 2 \\ 1 & 8 \end{vmatrix} = 58 - 21$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 19$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\frac8{dx} \left[ \int_{0}^{x^{2}} e^{-7t^{2}} \, dt \right] = 2x e^{-7x^{4}}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $f(x) = x^{2} + 19x + 7$ with $n = 19$.

### D16: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}6 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_6 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-17} & \cdots & c_{0} & \cdots & c_{17} \end{matrix}$$

Gibbs overshoot approaches 2 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\det\left(I_{17} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $e^{i\pi} + 1 = 0$ and $T(n) = 2 T\left(\frac17{2}\right) + \Theta(n)$ with $n = 17$.

### D17: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_22 &= (1-\rho)\rho^22, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_22 = \lambda & n \geq 0 \\ \mu_22 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.15$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\det\left(I_{22} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $f(x) = x^{2} + 22x + 15$ with $n = 22$.

### D18: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{22} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 5 & 6 & 0 \\ 2 & 1 & 3 \\ 0 & 7 & 5 \end{pmatrix}$$

Strict diagonal dominance with $N = 22$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\frac1{dx} \left[ \int_{0}^{x^{2}} e^{-26t^{2}} \, dt \right] = 2x e^{-26x^{4}}$$

A quick check uses $f(x) = x^{2} + 22x + 26$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 22$.

### D19: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 6 \pmod{2} \\ x &\equiv \pm r \pmod{2} \\ N &= 1 + \left(\frac{6}{2}\right)
\end{aligned}$$

$$\begin{pmatrix} 6 & 1 \\ 0 & 2 \end{pmatrix}$$

The Legendre symbol $\left(\frac{6}{2}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\left\| \sum_{k=1}^{3} \frac{A^12}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{3+1}}{(3+1)!} e^{\lVert A \rVert}$$

A quick check uses $T(n) = 2 T\left(\frac3{2}\right) + \Theta(n)$ and $E = mc^{2}$ with $n = 3$.

### D20: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{4 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 4+\kappa & -\kappa \\ -\kappa & 4+\kappa \end{bmatrix}$$

With $\kappa = 4$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 12$ cycles.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 12$.

### D21: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 5 & 1 \\ 6 & 6 \end{vmatrix} = 56 - 16$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 21$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{25}} = \left(1 - 2^{1-25}\right) \zeta(25)$$

A quick check uses $T(n) = 2 T\left(\frac21{2}\right) + \Theta(n)$ and $e^{i\pi} + 1 = 0$ with $n = 21$.

### D22: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}4 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_4 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-45} & \cdots & c_{0} & \cdots & c_{45} \end{matrix}$$

Gibbs overshoot approaches 4 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\left\| \sum_{k=1}^{45} \frac{A^4}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{45+1}}{(45+1)!} e^{\lVert A \rVert}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $e^{i\pi} + 1 = 0$ with $n = 45$.

### D23: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_37 &= (1-\rho)\rho^37, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_37 = \lambda & n \geq 0 \\ \mu_37 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.23$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\frac7{dx} \left[ \int_{0}^{x^{2}} e^{-23t^{2}} \, dt \right] = 2x e^{-23x^{4}}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $a_{n+1} = a_37 + d$ with $n = 37$.

### D24: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{5} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 6 & 8 & 0 \\ 8 & 6 & 5 \\ 0 & 1 & 6 \end{pmatrix}$$

Strict diagonal dominance with $N = 5$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\frac6{dx} \left[ \int_{0}^{x^{2}} e^{-35t^{2}} \, dt \right] = 2x e^{-35x^{4}}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $f(x) = x^{2} + 5x + 35$ with $n = 5$.

### D25: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 3 \pmod{3} \\ x &\equiv \pm r \pmod{3} \\ N &= 1 + \left(\frac{3}{3}\right)
\end{aligned}$$

$$\begin{pmatrix} 3 & 1 \\ 0 & 3 \end{pmatrix}$$

The Legendre symbol $\left(\frac{3}{3}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\binom{6+3}{6} = \frac{(6+3)!}{6! \, 3!}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $T(n) = 2 T\left(\frac6{2}\right) + \Theta(n)$ with $n = 6$.

### D26: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{8 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 8+\kappa & -\kappa \\ -\kappa & 8+\kappa \end{bmatrix}$$

With $\kappa = 8$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 24$ cycles.

$$\left\| \sum_{k=1}^{24} \frac{A^8}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{24+1}}{(24+1)!} e^{\lVert A \rVert}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 24$.

### D27: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 8 & 6 \\ 5 & 9 \end{vmatrix} = 89 - 65$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 42$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\left\| \sum_{k=1}^{42} \frac{A^4}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{42+1}}{(42+1)!} e^{\lVert A \rVert}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $E = mc^{2}$ with $n = 42$.

### D28: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}10 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_10 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-25} & \cdots & c_{0} & \cdots & c_{25} \end{matrix}$$

Gibbs overshoot approaches 21 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{21}} = \left(1 - 2^{1-21}\right) \zeta(21)$$

A quick check uses $e^{i\pi} + 1 = 0$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 25$.

### D29: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_9 &= (1-\rho)\rho^9, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_9 = \lambda & n \geq 0 \\ \mu_9 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.37$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\frac2{dx} \left[ \int_{0}^{x^{2}} e^{-37t^{2}} \, dt \right] = 2x e^{-37x^{4}}$$

A quick check uses $a_{n+1} = a_9 + d$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 9$.

### D30: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{27} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 6 & 4 & 0 \\ 7 & 5 & 1 \\ 0 & 6 & 6 \end{pmatrix}$$

Strict diagonal dominance with $N = 27$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\left\| \sum_{k=1}^{27} \frac{A^2}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{27+1}}{(27+1)!} e^{\lVert A \rVert}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $E = mc^{2}$ with $n = 27$.

### D31: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 5 \pmod{2} \\ x &\equiv \pm r \pmod{2} \\ N &= 1 + \left(\frac{5}{2}\right)
\end{aligned}$$

$$\begin{pmatrix} 5 & 1 \\ 0 & 2 \end{pmatrix}$$

The Legendre symbol $\left(\frac{5}{2}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\binom{24+2}{24} = \frac{(24+2)!}{24! \, 2!}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $a_{n+1} = a_24 + d$ with $n = 24$.

### D32: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{8 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 8+\kappa & -\kappa \\ -\kappa & 8+\kappa \end{bmatrix}$$

With $\kappa = 8$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 40$ cycles.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{5}} = \left(1 - 2^{1-5}\right) \zeta(5)$$

A quick check uses $f(x) = x^{2} + 40x + 5$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 40$.

### D33: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 5 & 6 \\ 6 & 2 \end{vmatrix} = 52 - 66$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 29$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\left\| \sum_{k=1}^{29} \frac{A^10}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{29+1}}{(29+1)!} e^{\lVert A \rVert}$$

A quick check uses $T(n) = 2 T\left(\frac29{2}\right) + \Theta(n)$ and $a_{n+1} = a_29 + d$ with $n = 29$.

### D34: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}6 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_6 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-30} & \cdots & c_{0} & \cdots & c_{30} \end{matrix}$$

Gibbs overshoot approaches 35 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\frac4{dx} \left[ \int_{0}^{x^{2}} e^{-35t^{2}} \, dt \right] = 2x e^{-35x^{4}}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $E = mc^{2}$ with $n = 30$.

### D35: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_17 &= (1-\rho)\rho^17, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_17 = \lambda & n \geq 0 \\ \mu_17 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.16$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\frac1{dx} \left[ \int_{0}^{x^{2}} e^{-16t^{2}} \, dt \right] = 2x e^{-16x^{4}}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 17$.

### D36: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{32} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 2 & 3 & 0 \\ 9 & 8 & 5 \\ 0 & 4 & 2 \end{pmatrix}$$

Strict diagonal dominance with $N = 32$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\left\| \sum_{k=1}^{32} \frac{A^10}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{32+1}}{(32+1)!} e^{\lVert A \rVert}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $E = mc^{2}$ with $n = 32$.

### D37: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 8 \pmod{35} \\ x &\equiv \pm r \pmod{35} \\ N &= 1 + \left(\frac{8}{35}\right)
\end{aligned}$$

$$\begin{pmatrix} 8 & 1 \\ 0 & 35 \end{pmatrix}$$

The Legendre symbol $\left(\frac{8}{35}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $T(n) = 2 T\left(\frac44{2}\right) + \Theta(n)$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 44$.

### D38: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{7 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 7+\kappa & -\kappa \\ -\kappa & 7+\kappa \end{bmatrix}$$

With $\kappa = 7$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 13$ cycles.

$$\binom{13+33}{13} = \frac{(13+33)!}{13! \, 33!}$$

A quick check uses $a_{n+1} = a_13 + d$ and $e^{i\pi} + 1 = 0$ with $n = 13$.

### D39: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 3 & 8 \\ 7 & 6 \end{vmatrix} = 36 - 87$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 45$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{29}} = \left(1 - 2^{1-29}\right) \zeta(29)$$

A quick check uses $a_{n+1} = a_45 + d$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 45$.

### D40: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}6 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_6 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-21} & \cdots & c_{0} & \cdots & c_{21} \end{matrix}$$

Gibbs overshoot approaches 31 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\det\left(I_{21} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $f(x) = x^{2} + 21x + 31$ and $a_{n+1} = a_21 + d$ with $n = 21$.

### D41: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_24 &= (1-\rho)\rho^24, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_24 = \lambda & n \geq 0 \\ \mu_24 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.28$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\left\| \sum_{k=1}^{24} \frac{A^8}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{24+1}}{(24+1)!} e^{\lVert A \rVert}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $a_{n+1} = a_24 + d$ with $n = 24$.

### D42: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{7} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 7 & 8 & 0 \\ 3 & 2 & 8 \\ 0 & 2 & 7 \end{pmatrix}$$

Strict diagonal dominance with $N = 7$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\binom{7+23}{7} = \frac{(7+23)!}{7! \, 23!}$$

A quick check uses $a_{n+1} = a_7 + d$ and $e^{i\pi} + 1 = 0$ with $n = 7$.

### D43: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 7 \pmod{17} \\ x &\equiv \pm r \pmod{17} \\ N &= 1 + \left(\frac{7}{17}\right)
\end{aligned}$$

$$\begin{pmatrix} 7 & 1 \\ 0 & 17 \end{pmatrix}$$

The Legendre symbol $\left(\frac{7}{17}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\binom{15+17}{15} = \frac{(15+17)!}{15! \, 17!}$$

A quick check uses $T(n) = 2 T\left(\frac15{2}\right) + \Theta(n)$ and $E = mc^{2}$ with $n = 15$.

### D44: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{12 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 12+\kappa & -\kappa \\ -\kappa & 12+\kappa \end{bmatrix}$$

With $\kappa = 12$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 43$ cycles.

$$\left\| \sum_{k=1}^{43} \frac{A^12}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{43+1}}{(43+1)!} e^{\lVert A \rVert}$$

A quick check uses $T(n) = 2 T\left(\frac43{2}\right) + \Theta(n)$ and $a_{n+1} = a_43 + d$ with $n = 43$.

### D45: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 9 & 4 \\ 7 & 4 \end{vmatrix} = 94 - 47$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 3$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{11}} = \left(1 - 2^{1-11}\right) \zeta(11)$$

A quick check uses $f(x) = x^{2} + 3x + 11$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 3$.

### D46: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}5 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_5 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-18} & \cdots & c_{0} & \cdots & c_{18} \end{matrix}$$

Gibbs overshoot approaches 26 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $E = mc^{2}$ with $n = 18$.

### D47: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_25 &= (1-\rho)\rho^25, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_25 = \lambda & n \geq 0 \\ \mu_25 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.40$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\left\| \sum_{k=1}^{25} \frac{A^6}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{25+1}}{(25+1)!} e^{\lVert A \rVert}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 25$.

### D48: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{35} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 7 & 6 & 0 \\ 6 & 6 & 1 \\ 0 & 8 & 7 \end{pmatrix}$$

Strict diagonal dominance with $N = 35$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{10}} = \left(1 - 2^{1-10}\right) \zeta(10)$$

A quick check uses $E = mc^{2}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 35$.

### D49: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 6 \pmod{16} \\ x &\equiv \pm r \pmod{16} \\ N &= 1 + \left(\frac{6}{16}\right)
\end{aligned}$$

$$\begin{pmatrix} 6 & 1 \\ 0 & 16 \end{pmatrix}$$

The Legendre symbol $\left(\frac{6}{16}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\det\left(I_{47} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $a_{n+1} = a_47 + d$ and $E = mc^{2}$ with $n = 47$.

### D50: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{6 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 6+\kappa & -\kappa \\ -\kappa & 6+\kappa \end{bmatrix}$$

With $\kappa = 6$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 21$ cycles.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $e^{i\pi} + 1 = 0$ and $a_{n+1} = a_21 + d$ with $n = 21$.

### D51: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 6 & 6 \\ 4 & 3 \end{vmatrix} = 63 - 64$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 6$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{29}} = \left(1 - 2^{1-29}\right) \zeta(29)$$

A quick check uses $E = mc^{2}$ and $f(x) = x^{2} + 6x + 29$ with $n = 6$.

### D52: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}4 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_4 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-38} & \cdots & c_{0} & \cdots & c_{38} \end{matrix}$$

Gibbs overshoot approaches 20 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\binom{38+20}{38} = \frac{(38+20)!}{38! \, 20!}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 38$.

### D53: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_36 &= (1-\rho)\rho^36, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_36 = \lambda & n \geq 0 \\ \mu_36 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.34$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\binom{36+34}{36} = \frac{(36+34)!}{36! \, 34!}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 36$.

### D54: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{25} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 5 & 3 & 0 \\ 2 & 2 & 4 \\ 0 & 8 & 5 \end{pmatrix}$$

Strict diagonal dominance with $N = 25$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{17}} = \left(1 - 2^{1-17}\right) \zeta(17)$$

A quick check uses $a_{n+1} = a_25 + d$ and $T(n) = 2 T\left(\frac25{2}\right) + \Theta(n)$ with $n = 25$.

### D55: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 4 \pmod{33} \\ x &\equiv \pm r \pmod{33} \\ N &= 1 + \left(\frac{4}{33}\right)
\end{aligned}$$

$$\begin{pmatrix} 4 & 1 \\ 0 & 33 \end{pmatrix}$$

The Legendre symbol $\left(\frac{4}{33}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{33}} = \left(1 - 2^{1-33}\right) \zeta(33)$$

A quick check uses $T(n) = 2 T\left(\frac43{2}\right) + \Theta(n)$ and $T(n) = 2 T\left(\frac43{2}\right) + \Theta(n)$ with $n = 43$.

### D56: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{2 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 2+\kappa & -\kappa \\ -\kappa & 2+\kappa \end{bmatrix}$$

With $\kappa = 2$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 6$ cycles.

$$\binom{6+15}{6} = \frac{(6+15)!}{6! \, 15!}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 6$.

### D57: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 6 & 4 \\ 7 & 8 \end{vmatrix} = 68 - 47$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 35$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\frac8{dx} \left[ \int_{0}^{x^{2}} e^{-37t^{2}} \, dt \right] = 2x e^{-37x^{4}}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $T(n) = 2 T\left(\frac35{2}\right) + \Theta(n)$ with $n = 35$.

### D58: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}2 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_2 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-47} & \cdots & c_{0} & \cdots & c_{47} \end{matrix}$$

Gibbs overshoot approaches 10 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{10}} = \left(1 - 2^{1-10}\right) \zeta(10)$$

A quick check uses $f(x) = x^{2} + 47x + 10$ and $E = mc^{2}$ with $n = 47$.

### D59: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_13 &= (1-\rho)\rho^13, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_13 = \lambda & n \geq 0 \\ \mu_13 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.26$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\left\| \sum_{k=1}^{13} \frac{A^7}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{13+1}}{(13+1)!} e^{\lVert A \rVert}$$

A quick check uses $E = mc^{2}$ and $E = mc^{2}$ with $n = 13$.

### D60: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{26} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 8 & 9 & 0 \\ 2 & 1 & 5 \\ 0 & 5 & 8 \end{pmatrix}$$

Strict diagonal dominance with $N = 26$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\left\| \sum_{k=1}^{26} \frac{A^10}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{26+1}}{(26+1)!} e^{\lVert A \rVert}$$

A quick check uses $f(x) = x^{2} + 26x + 24$ and $E = mc^{2}$ with $n = 26$.

### D61: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 4 \pmod{32} \\ x &\equiv \pm r \pmod{32} \\ N &= 1 + \left(\frac{4}{32}\right)
\end{aligned}$$

$$\begin{pmatrix} 4 & 1 \\ 0 & 32 \end{pmatrix}$$

The Legendre symbol $\left(\frac{4}{32}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\left\| \sum_{k=1}^{20} \frac{A^3}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{20+1}}{(20+1)!} e^{\lVert A \rVert}$$

A quick check uses $T(n) = 2 T\left(\frac20{2}\right) + \Theta(n)$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 20$.

### D62: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{6 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 6+\kappa & -\kappa \\ -\kappa & 6+\kappa \end{bmatrix}$$

With $\kappa = 6$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 18$ cycles.

$$\left\| \sum_{k=1}^{18} \frac{A^6}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{18+1}}{(18+1)!} e^{\lVert A \rVert}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 18$.

### D63: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 4 & 5 \\ 7 & 5 \end{vmatrix} = 45 - 57$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 33$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\det\left(I_{33} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $a_{n+1} = a_33 + d$ and $f(x) = x^{2} + 33x + 38$ with $n = 33$.

### D64: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}3 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_3 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-4} & \cdots & c_{0} & \cdots & c_{4} \end{matrix}$$

Gibbs overshoot approaches 31 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\frac2{dx} \left[ \int_{0}^{x^{2}} e^{-31t^{2}} \, dt \right] = 2x e^{-31x^{4}}$$

A quick check uses $f(x) = x^{2} + 4x + 31$ and $e^{i\pi} + 1 = 0$ with $n = 4$.

### D65: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_8 &= (1-\rho)\rho^8, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_8 = \lambda & n \geq 0 \\ \mu_8 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.20$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\left\| \sum_{k=1}^{8} \frac{A^6}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{8+1}}{(8+1)!} e^{\lVert A \rVert}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $T(n) = 2 T\left(\frac8{2}\right) + \Theta(n)$ with $n = 8$.

### D66: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{26} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 8 & 7 & 0 \\ 1 & 3 & 8 \\ 0 & 1 & 8 \end{pmatrix}$$

Strict diagonal dominance with $N = 26$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\binom{26+11}{26} = \frac{(26+11)!}{26! \, 11!}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 26$.

### D67: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 3 \pmod{23} \\ x &\equiv \pm r \pmod{23} \\ N &= 1 + \left(\frac{3}{23}\right)
\end{aligned}$$

$$\begin{pmatrix} 3 & 1 \\ 0 & 23 \end{pmatrix}$$

The Legendre symbol $\left(\frac{3}{23}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\binom{20+23}{20} = \frac{(20+23)!}{20! \, 23!}$$

A quick check uses $a_{n+1} = a_20 + d$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 20$.

### D68: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{3 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 3+\kappa & -\kappa \\ -\kappa & 3+\kappa \end{bmatrix}$$

With $\kappa = 3$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 46$ cycles.

$$\frac1{dx} \left[ \int_{0}^{x^{2}} e^{-9t^{2}} \, dt \right] = 2x e^{-9x^{4}}$$

A quick check uses $E = mc^{2}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 46$.

### D69: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 5 & 8 \\ 9 & 1 \end{vmatrix} = 51 - 89$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 10$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\det\left(I_{10} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $E = mc^{2}$ and $T(n) = 2 T\left(\frac10{2}\right) + \Theta(n)$ with $n = 10$.

### D70: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}8 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_8 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-44} & \cdots & c_{0} & \cdots & c_{44} \end{matrix}$$

Gibbs overshoot approaches 23 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\det\left(I_{44} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $e^{i\pi} + 1 = 0$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 44$.

### D71: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_46 &= (1-\rho)\rho^46, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_46 = \lambda & n \geq 0 \\ \mu_46 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.36$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\binom{46+36}{46} = \frac{(46+36)!}{46! \, 36!}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $a_{n+1} = a_46 + d$ with $n = 46$.

### D72: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{8} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 8 & 7 & 0 \\ 7 & 7 & 9 \\ 0 & 1 & 8 \end{pmatrix}$$

Strict diagonal dominance with $N = 8$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\binom{8+38}{8} = \frac{(8+38)!}{8! \, 38!}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 8$.

### D73: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 2 \pmod{5} \\ x &\equiv \pm r \pmod{5} \\ N &= 1 + \left(\frac{2}{5}\right)
\end{aligned}$$

$$\begin{pmatrix} 2 & 1 \\ 0 & 5 \end{pmatrix}$$

The Legendre symbol $\left(\frac{2}{5}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $f(x) = x^{2} + 36x + 5$ with $n = 36$.

### D74: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{7 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 7+\kappa & -\kappa \\ -\kappa & 7+\kappa \end{bmatrix}$$

With $\kappa = 7$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 40$ cycles.

$$\frac8{dx} \left[ \int_{0}^{x^{2}} e^{-15t^{2}} \, dt \right] = 2x e^{-15x^{4}}$$

A quick check uses $f(x) = x^{2} + 40x + 15$ and $E = mc^{2}$ with $n = 40$.

### D75: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 8 & 4 \\ 3 & 6 \end{vmatrix} = 86 - 43$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 14$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\det\left(I_{14} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $E = mc^{2}$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 14$.

### D76: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}8 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_8 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-23} & \cdots & c_{0} & \cdots & c_{23} \end{matrix}$$

Gibbs overshoot approaches 10 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{10}} = \left(1 - 2^{1-10}\right) \zeta(10)$$

A quick check uses $E = mc^{2}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 23$.

### D77: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_28 &= (1-\rho)\rho^28, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_28 = \lambda & n \geq 0 \\ \mu_28 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.27$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\det\left(I_{28} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $E = mc^{2}$ with $n = 28$.

### D78: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{31} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 2 & 1 & 0 \\ 8 & 5 & 3 \\ 0 & 1 & 2 \end{pmatrix}$$

Strict diagonal dominance with $N = 31$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\frac5{dx} \left[ \int_{0}^{x^{2}} e^{-6t^{2}} \, dt \right] = 2x e^{-6x^{4}}$$

A quick check uses $a_{n+1} = a_31 + d$ and $a_{n+1} = a_31 + d$ with $n = 31$.

### D79: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 5 \pmod{9} \\ x &\equiv \pm r \pmod{9} \\ N &= 1 + \left(\frac{5}{9}\right)
\end{aligned}$$

$$\begin{pmatrix} 5 & 1 \\ 0 & 9 \end{pmatrix}$$

The Legendre symbol $\left(\frac{5}{9}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\frac2{dx} \left[ \int_{0}^{x^{2}} e^{-9t^{2}} \, dt \right] = 2x e^{-9x^{4}}$$

A quick check uses $T(n) = 2 T\left(\frac24{2}\right) + \Theta(n)$ and $E = mc^{2}$ with $n = 24$.

### D80: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{5 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 5+\kappa & -\kappa \\ -\kappa & 5+\kappa \end{bmatrix}$$

With $\kappa = 5$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 44$ cycles.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{29}} = \left(1 - 2^{1-29}\right) \zeta(29)$$

A quick check uses $T(n) = 2 T\left(\frac44{2}\right) + \Theta(n)$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 44$.

### D81: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 9 & 1 \\ 2 & 5 \end{vmatrix} = 95 - 12$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 4$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\det\left(I_{4} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $f(x) = x^{2} + 4x + 37$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 4$.

### D82: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}4 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_4 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-31} & \cdots & c_{0} & \cdots & c_{31} \end{matrix}$$

Gibbs overshoot approaches 27 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\binom{31+27}{31} = \frac{(31+27)!}{31! \, 27!}$$

A quick check uses $E = mc^{2}$ and $a_{n+1} = a_31 + d$ with $n = 31$.

### D83: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_9 &= (1-\rho)\rho^9, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_9 = \lambda & n \geq 0 \\ \mu_9 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.28$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\frac8{dx} \left[ \int_{0}^{x^{2}} e^{-28t^{2}} \, dt \right] = 2x e^{-28x^{4}}$$

A quick check uses $f(x) = x^{2} + 9x + 28$ and $E = mc^{2}$ with $n = 9$.

### D84: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{45} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 6 & 6 & 0 \\ 4 & 8 & 2 \\ 0 & 6 & 6 \end{pmatrix}$$

Strict diagonal dominance with $N = 45$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\left\| \sum_{k=1}^{45} \frac{A^7}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{45+1}}{(45+1)!} e^{\lVert A \rVert}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 45$.

### D85: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 2 \pmod{9} \\ x &\equiv \pm r \pmod{9} \\ N &= 1 + \left(\frac{2}{9}\right)
\end{aligned}$$

$$\begin{pmatrix} 2 & 1 \\ 0 & 9 \end{pmatrix}$$

The Legendre symbol $\left(\frac{2}{9}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\left\| \sum_{k=1}^{35} \frac{A^8}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{35+1}}{(35+1)!} e^{\lVert A \rVert}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $E = mc^{2}$ with $n = 35$.

### D86: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{7 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 7+\kappa & -\kappa \\ -\kappa & 7+\kappa \end{bmatrix}$$

With $\kappa = 7$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 37$ cycles.

$$\binom{37+8}{37} = \frac{(37+8)!}{37! \, 8!}$$

A quick check uses $T(n) = 2 T\left(\frac37{2}\right) + \Theta(n)$ and $e^{i\pi} + 1 = 0$ with $n = 37$.

### D87: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 7 & 7 \\ 3 & 8 \end{vmatrix} = 78 - 73$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 8$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\left\| \sum_{k=1}^{8} \frac{A^4}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{8+1}}{(8+1)!} e^{\lVert A \rVert}$$

A quick check uses $T(n) = 2 T\left(\frac8{2}\right) + \Theta(n)$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 8$.

### D88: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}5 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_5 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-4} & \cdots & c_{0} & \cdots & c_{4} \end{matrix}$$

Gibbs overshoot approaches 4 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\det\left(I_{4} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $E = mc^{2}$ and $e^{i\pi} + 1 = 0$ with $n = 4$.

### D89: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_10 &= (1-\rho)\rho^10, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_10 = \lambda & n \geq 0 \\ \mu_10 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.19$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\binom{10+19}{10} = \frac{(10+19)!}{10! \, 19!}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $E = mc^{2}$ with $n = 10$.

### D90: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{18} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 9 & 3 & 0 \\ 4 & 8 & 3 \\ 0 & 6 & 9 \end{pmatrix}$$

Strict diagonal dominance with $N = 18$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{15}} = \left(1 - 2^{1-15}\right) \zeta(15)$$

A quick check uses $e^{i\pi} + 1 = 0$ and $E = mc^{2}$ with $n = 18$.

### D91: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 6 \pmod{36} \\ x &\equiv \pm r \pmod{36} \\ N &= 1 + \left(\frac{6}{36}\right)
\end{aligned}$$

$$\begin{pmatrix} 6 & 1 \\ 0 & 36 \end{pmatrix}$$

The Legendre symbol $\left(\frac{6}{36}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\frac8{dx} \left[ \int_{0}^{x^{2}} e^{-36t^{2}} \, dt \right] = 2x e^{-36x^{4}}$$

A quick check uses $a_{n+1} = a_40 + d$ and $E = mc^{2}$ with $n = 40$.

### D92: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{3 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 3+\kappa & -\kappa \\ -\kappa & 3+\kappa \end{bmatrix}$$

With $\kappa = 3$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 27$ cycles.

$$\det\left(I_{27} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 27$.

### D93: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 3 & 6 \\ 2 & 3 \end{vmatrix} = 33 - 62$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 35$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\left\| \sum_{k=1}^{35} \frac{A^7}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{35+1}}{(35+1)!} e^{\lVert A \rVert}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 35$.

### D94: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}11 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_11 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-5} & \cdots & c_{0} & \cdots & c_{5} \end{matrix}$$

Gibbs overshoot approaches 26 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{26}} = \left(1 - 2^{1-26}\right) \zeta(26)$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $E = mc^{2}$ with $n = 5$.

### D95: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_23 &= (1-\rho)\rho^23, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_23 = \lambda & n \geq 0 \\ \mu_23 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.27$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\frac3{dx} \left[ \int_{0}^{x^{2}} e^{-27t^{2}} \, dt \right] = 2x e^{-27x^{4}}$$

A quick check uses $T(n) = 2 T\left(\frac23{2}\right) + \Theta(n)$ and $a_{n+1} = a_23 + d$ with $n = 23$.

### D96: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{31} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 3 & 5 & 0 \\ 2 & 8 & 4 \\ 0 & 9 & 3 \end{pmatrix}$$

Strict diagonal dominance with $N = 31$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\frac8{dx} \left[ \int_{0}^{x^{2}} e^{-31t^{2}} \, dt \right] = 2x e^{-31x^{4}}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $E = mc^{2}$ with $n = 31$.

### D97: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 4 \pmod{12} \\ x &\equiv \pm r \pmod{12} \\ N &= 1 + \left(\frac{4}{12}\right)
\end{aligned}$$

$$\begin{pmatrix} 4 & 1 \\ 0 & 12 \end{pmatrix}$$

The Legendre symbol $\left(\frac{4}{12}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $T(n) = 2 T\left(\frac5{2}\right) + \Theta(n)$ and $f(x) = x^{2} + 5x + 12$ with $n = 5$.

### D98: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{9 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 9+\kappa & -\kappa \\ -\kappa & 9+\kappa \end{bmatrix}$$

With $\kappa = 9$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 48$ cycles.

$$\binom{48+6}{48} = \frac{(48+6)!}{48! \, 6!}$$

A quick check uses $E = mc^{2}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 48$.

### D99: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 9 & 7 \\ 7 & 9 \end{vmatrix} = 99 - 77$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 33$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\frac9{dx} \left[ \int_{0}^{x^{2}} e^{-35t^{2}} \, dt \right] = 2x e^{-35x^{4}}$$

A quick check uses $f(x) = x^{2} + 33x + 35$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 33$.

### D100: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}11 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_11 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-9} & \cdots & c_{0} & \cdots & c_{9} \end{matrix}$$

Gibbs overshoot approaches 31 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\frac9{dx} \left[ \int_{0}^{x^{2}} e^{-31t^{2}} \, dt \right] = 2x e^{-31x^{4}}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $T(n) = 2 T\left(\frac9{2}\right) + \Theta(n)$ with $n = 9$.

### D101: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_16 &= (1-\rho)\rho^16, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_16 = \lambda & n \geq 0 \\ \mu_16 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.2$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\frac1{dx} \left[ \int_{0}^{x^{2}} e^{-2t^{2}} \, dt \right] = 2x e^{-2x^{4}}$$

A quick check uses $f(x) = x^{2} + 16x + 2$ and $f(x) = x^{2} + 16x + 2$ with $n = 16$.

### D102: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{12} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 4 & 5 & 0 \\ 2 & 7 & 2 \\ 0 & 2 & 4 \end{pmatrix}$$

Strict diagonal dominance with $N = 12$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{37}} = \left(1 - 2^{1-37}\right) \zeta(37)$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $a_{n+1} = a_12 + d$ with $n = 12$.

### D103: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 6 \pmod{26} \\ x &\equiv \pm r \pmod{26} \\ N &= 1 + \left(\frac{6}{26}\right)
\end{aligned}$$

$$\begin{pmatrix} 6 & 1 \\ 0 & 26 \end{pmatrix}$$

The Legendre symbol $\left(\frac{6}{26}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $f(x) = x^{2} + 36x + 26$ and $T(n) = 2 T\left(\frac36{2}\right) + \Theta(n)$ with $n = 36$.

### D104: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{11 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 11+\kappa & -\kappa \\ -\kappa & 11+\kappa \end{bmatrix}$$

With $\kappa = 11$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 32$ cycles.

$$\binom{32+27}{32} = \frac{(32+27)!}{32! \, 27!}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $T(n) = 2 T\left(\frac32{2}\right) + \Theta(n)$ with $n = 32$.

### D105: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 4 & 7 \\ 2 & 7 \end{vmatrix} = 47 - 72$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 38$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{6}} = \left(1 - 2^{1-6}\right) \zeta(6)$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $e^{i\pi} + 1 = 0$ with $n = 38$.

### D106: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}7 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_7 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-14} & \cdots & c_{0} & \cdots & c_{14} \end{matrix}$$

Gibbs overshoot approaches 26 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\det\left(I_{14} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $T(n) = 2 T\left(\frac14{2}\right) + \Theta(n)$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 14$.

### D107: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_38 &= (1-\rho)\rho^38, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_38 = \lambda & n \geq 0 \\ \mu_38 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.11$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\left\| \sum_{k=1}^{38} \frac{A^2}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{38+1}}{(38+1)!} e^{\lVert A \rVert}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $T(n) = 2 T\left(\frac38{2}\right) + \Theta(n)$ with $n = 38$.

### D108: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{23} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 1 & 6 & 0 \\ 6 & 5 & 8 \\ 0 & 1 & 1 \end{pmatrix}$$

Strict diagonal dominance with $N = 23$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\binom{23+24}{23} = \frac{(23+24)!}{23! \, 24!}$$

A quick check uses $E = mc^{2}$ and $a_{n+1} = a_23 + d$ with $n = 23$.

### D109: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 8 \pmod{29} \\ x &\equiv \pm r \pmod{29} \\ N &= 1 + \left(\frac{8}{29}\right)
\end{aligned}$$

$$\begin{pmatrix} 8 & 1 \\ 0 & 29 \end{pmatrix}$$

The Legendre symbol $\left(\frac{8}{29}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\left\| \sum_{k=1}^{6} \frac{A^12}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{6+1}}{(6+1)!} e^{\lVert A \rVert}$$

A quick check uses $f(x) = x^{2} + 6x + 29$ and $a_{n+1} = a_6 + d$ with $n = 6$.

### D110: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{7 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 7+\kappa & -\kappa \\ -\kappa & 7+\kappa \end{bmatrix}$$

With $\kappa = 7$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 35$ cycles.

$$\det\left(I_{35} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $T(n) = 2 T\left(\frac35{2}\right) + \Theta(n)$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 35$.

### D111: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 3 & 7 \\ 9 & 4 \end{vmatrix} = 34 - 79$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 16$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\frac4{dx} \left[ \int_{0}^{x^{2}} e^{-37t^{2}} \, dt \right] = 2x e^{-37x^{4}}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 16$.

### D112: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}8 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_8 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-34} & \cdots & c_{0} & \cdots & c_{34} \end{matrix}$$

Gibbs overshoot approaches 18 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\binom{34+18}{34} = \frac{(34+18)!}{34! \, 18!}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 34$.

### D113: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_40 &= (1-\rho)\rho^40, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_40 = \lambda & n \geq 0 \\ \mu_40 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.3$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\left\| \sum_{k=1}^{40} \frac{A^7}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{40+1}}{(40+1)!} e^{\lVert A \rVert}$$

A quick check uses $f(x) = x^{2} + 40x + 3$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 40$.

### D114: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{8} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 5 & 9 & 0 \\ 8 & 8 & 2 \\ 0 & 3 & 5 \end{pmatrix}$$

Strict diagonal dominance with $N = 8$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\left\| \sum_{k=1}^{8} \frac{A^9}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{8+1}}{(8+1)!} e^{\lVert A \rVert}$$

A quick check uses $a_{n+1} = a_8 + d$ and $e^{i\pi} + 1 = 0$ with $n = 8$.

### D115: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 9 \pmod{25} \\ x &\equiv \pm r \pmod{25} \\ N &= 1 + \left(\frac{9}{25}\right)
\end{aligned}$$

$$\begin{pmatrix} 9 & 1 \\ 0 & 25 \end{pmatrix}$$

The Legendre symbol $\left(\frac{9}{25}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\det\left(I_{8} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $f(x) = x^{2} + 8x + 25$ with $n = 8$.

### D116: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{9 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 9+\kappa & -\kappa \\ -\kappa & 9+\kappa \end{bmatrix}$$

With $\kappa = 9$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 19$ cycles.

$$\frac8{dx} \left[ \int_{0}^{x^{2}} e^{-3t^{2}} \, dt \right] = 2x e^{-3x^{4}}$$

A quick check uses $T(n) = 2 T\left(\frac19{2}\right) + \Theta(n)$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 19$.

### D117: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 9 & 4 \\ 5 & 2 \end{vmatrix} = 92 - 45$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 17$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $e^{i\pi} + 1 = 0$ with $n = 17$.

### D118: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}10 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_10 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-21} & \cdots & c_{0} & \cdots & c_{21} \end{matrix}$$

Gibbs overshoot approaches 39 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\binom{21+39}{21} = \frac{(21+39)!}{21! \, 39!}$$

A quick check uses $E = mc^{2}$ and $f(x) = x^{2} + 21x + 39$ with $n = 21$.

### D119: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_17 &= (1-\rho)\rho^17, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_17 = \lambda & n \geq 0 \\ \mu_17 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.15$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\frac5{dx} \left[ \int_{0}^{x^{2}} e^{-15t^{2}} \, dt \right] = 2x e^{-15x^{4}}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $E = mc^{2}$ with $n = 17$.

### D120: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{30} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 5 & 1 & 0 \\ 8 & 5 & 4 \\ 0 & 6 & 5 \end{pmatrix}$$

Strict diagonal dominance with $N = 30$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{20}} = \left(1 - 2^{1-20}\right) \zeta(20)$$

A quick check uses $T(n) = 2 T\left(\frac30{2}\right) + \Theta(n)$ and $T(n) = 2 T\left(\frac30{2}\right) + \Theta(n)$ with $n = 30$.

### D121: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 7 \pmod{23} \\ x &\equiv \pm r \pmod{23} \\ N &= 1 + \left(\frac{7}{23}\right)
\end{aligned}$$

$$\begin{pmatrix} 7 & 1 \\ 0 & 23 \end{pmatrix}$$

The Legendre symbol $\left(\frac{7}{23}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\det\left(I_{34} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $f(x) = x^{2} + 34x + 23$ with $n = 34$.

### D122: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{8 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 8+\kappa & -\kappa \\ -\kappa & 8+\kappa \end{bmatrix}$$

With $\kappa = 8$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 29$ cycles.

$$\det\left(I_{29} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $e^{i\pi} + 1 = 0$ and $f(x) = x^{2} + 29x + 8$ with $n = 29$.

### D123: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 9 & 2 \\ 2 & 5 \end{vmatrix} = 95 - 22$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 33$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $T(n) = 2 T\left(\frac33{2}\right) + \Theta(n)$ and $f(x) = x^{2} + 33x + 4$ with $n = 33$.

### D124: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}3 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_3 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-21} & \cdots & c_{0} & \cdots & c_{21} \end{matrix}$$

Gibbs overshoot approaches 3 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\left\| \sum_{k=1}^{21} \frac{A^3}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{21+1}}{(21+1)!} e^{\lVert A \rVert}$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $f(x) = x^{2} + 21x + 3$ with $n = 21$.

### D125: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_36 &= (1-\rho)\rho^36, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_36 = \lambda & n \geq 0 \\ \mu_36 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.5$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $e^{i\pi} + 1 = 0$ with $n = 36$.

### D126: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{32} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 2 & 2 & 0 \\ 3 & 1 & 5 \\ 0 & 3 & 2 \end{pmatrix}$$

Strict diagonal dominance with $N = 32$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\binom{32+7}{32} = \frac{(32+7)!}{32! \, 7!}$$

A quick check uses $E = mc^{2}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 32$.

### D127: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 4 \pmod{34} \\ x &\equiv \pm r \pmod{34} \\ N &= 1 + \left(\frac{4}{34}\right)
\end{aligned}$$

$$\begin{pmatrix} 4 & 1 \\ 0 & 34 \end{pmatrix}$$

The Legendre symbol $\left(\frac{4}{34}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\frac8{dx} \left[ \int_{0}^{x^{2}} e^{-34t^{2}} \, dt \right] = 2x e^{-34x^{4}}$$

A quick check uses $f(x) = x^{2} + 40x + 34$ and $E = mc^{2}$ with $n = 40$.

### D128: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{2 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 2+\kappa & -\kappa \\ -\kappa & 2+\kappa \end{bmatrix}$$

With $\kappa = 2$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 17$ cycles.

$$\det\left(I_{17} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $f(x) = x^{2} + 17x + 37$ and $a_{n+1} = a_17 + d$ with $n = 17$.

### D129: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 2 & 2 \\ 6 & 8 \end{vmatrix} = 28 - 26$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 30$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\left\| \sum_{k=1}^{30} \frac{A^10}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{30+1}}{(30+1)!} e^{\lVert A \rVert}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 30$.

### D130: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}11 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_11 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-15} & \cdots & c_{0} & \cdots & c_{15} \end{matrix}$$

Gibbs overshoot approaches 3 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\left\| \sum_{k=1}^{15} \frac{A^11}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{15+1}}{(15+1)!} e^{\lVert A \rVert}$$

A quick check uses $T(n) = 2 T\left(\frac15{2}\right) + \Theta(n)$ and $f(x) = x^{2} + 15x + 3$ with $n = 15$.

### D131: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_4 &= (1-\rho)\rho^4, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_4 = \lambda & n \geq 0 \\ \mu_4 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.4$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $E = mc^{2}$ with $n = 4$.

### D132: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{7} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 2 & 2 & 0 \\ 8 & 8 & 6 \\ 0 & 9 & 2 \end{pmatrix}$$

Strict diagonal dominance with $N = 7$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\det\left(I_{7} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $f(x) = x^{2} + 7x + 2$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 7$.

### D133: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 3 \pmod{39} \\ x &\equiv \pm r \pmod{39} \\ N &= 1 + \left(\frac{3}{39}\right)
\end{aligned}$$

$$\begin{pmatrix} 3 & 1 \\ 0 & 39 \end{pmatrix}$$

The Legendre symbol $\left(\frac{3}{39}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\frac3{dx} \left[ \int_{0}^{x^{2}} e^{-39t^{2}} \, dt \right] = 2x e^{-39x^{4}}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $a_{n+1} = a_39 + d$ with $n = 39$.

### D134: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{5 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 5+\kappa & -\kappa \\ -\kappa & 5+\kappa \end{bmatrix}$$

With $\kappa = 5$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 41$ cycles.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $a_{n+1} = a_41 + d$ and $T(n) = 2 T\left(\frac41{2}\right) + \Theta(n)$ with $n = 41$.

### D135: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 6 & 5 \\ 1 & 2 \end{vmatrix} = 62 - 51$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 39$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{28}} = \left(1 - 2^{1-28}\right) \zeta(28)$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $e^{i\pi} + 1 = 0$ with $n = 39$.

### D136: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}5 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_5 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-7} & \cdots & c_{0} & \cdots & c_{7} \end{matrix}$$

Gibbs overshoot approaches 11 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\left\| \sum_{k=1}^{7} \frac{A^5}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{7+1}}{(7+1)!} e^{\lVert A \rVert}$$

A quick check uses $E = mc^{2}$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 7$.

### D137: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_48 &= (1-\rho)\rho^48, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_48 = \lambda & n \geq 0 \\ \mu_48 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.2$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\left\| \sum_{k=1}^{48} \frac{A^9}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{48+1}}{(48+1)!} e^{\lVert A \rVert}$$

A quick check uses $f(x) = x^{2} + 48x + 2$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 48$.

### D138: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{8} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 9 & 6 & 0 \\ 4 & 5 & 6 \\ 0 & 5 & 9 \end{pmatrix}$$

Strict diagonal dominance with $N = 8$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\binom{8+28}{8} = \frac{(8+28)!}{8! \, 28!}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $f(x) = x^{2} + 8x + 28$ with $n = 8$.

### D139: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 7 \pmod{11} \\ x &\equiv \pm r \pmod{11} \\ N &= 1 + \left(\frac{7}{11}\right)
\end{aligned}$$

$$\begin{pmatrix} 7 & 1 \\ 0 & 11 \end{pmatrix}$$

The Legendre symbol $\left(\frac{7}{11}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $e^{i\pi} + 1 = 0$ and $e^{i\pi} + 1 = 0$ with $n = 45$.

### D140: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{8 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 8+\kappa & -\kappa \\ -\kappa & 8+\kappa \end{bmatrix}$$

With $\kappa = 8$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 16$ cycles.

$$\left\| \sum_{k=1}^{16} \frac{A^8}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{16+1}}{(16+1)!} e^{\lVert A \rVert}$$

A quick check uses $a_{n+1} = a_16 + d$ and $E = mc^{2}$ with $n = 16$.

### D141: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 8 & 9 \\ 9 & 5 \end{vmatrix} = 85 - 99$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 37$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\det\left(I_{37} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 37$.

### D142: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}3 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_3 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-7} & \cdots & c_{0} & \cdots & c_{7} \end{matrix}$$

Gibbs overshoot approaches 3 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\det\left(I_{7} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 7$.

### D143: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_25 &= (1-\rho)\rho^25, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_25 = \lambda & n \geq 0 \\ \mu_25 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.26$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{26}} = \left(1 - 2^{1-26}\right) \zeta(26)$$

A quick check uses $T(n) = 2 T\left(\frac25{2}\right) + \Theta(n)$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 25$.

### D144: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{38} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 1 & 6 & 0 \\ 6 & 5 & 8 \\ 0 & 2 & 1 \end{pmatrix}$$

Strict diagonal dominance with $N = 38$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\frac5{dx} \left[ \int_{0}^{x^{2}} e^{-20t^{2}} \, dt \right] = 2x e^{-20x^{4}}$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $T(n) = 2 T\left(\frac38{2}\right) + \Theta(n)$ with $n = 38$.

### D145: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 5 \pmod{34} \\ x &\equiv \pm r \pmod{34} \\ N &= 1 + \left(\frac{5}{34}\right)
\end{aligned}$$

$$\begin{pmatrix} 5 & 1 \\ 0 & 34 \end{pmatrix}$$

The Legendre symbol $\left(\frac{5}{34}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{34}} = \left(1 - 2^{1-34}\right) \zeta(34)$$

A quick check uses $E = mc^{2}$ and $f(x) = x^{2} + 6x + 34$ with $n = 6$.

### D146: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{6 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 6+\kappa & -\kappa \\ -\kappa & 6+\kappa \end{bmatrix}$$

With $\kappa = 6$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 17$ cycles.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{3}} = \left(1 - 2^{1-3}\right) \zeta(3)$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $e^{i\pi} + 1 = 0$ with $n = 17$.

### D147: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 2 & 5 \\ 2 & 7 \end{vmatrix} = 27 - 52$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 40$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\binom{40+6}{40} = \frac{(40+6)!}{40! \, 6!}$$

A quick check uses $E = mc^{2}$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 40$.

### D148: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}7 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_7 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-18} & \cdots & c_{0} & \cdots & c_{18} \end{matrix}$$

Gibbs overshoot approaches 32 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\left\| \sum_{k=1}^{18} \frac{A^7}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{18+1}}{(18+1)!} e^{\lVert A \rVert}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $e^{i\pi} + 1 = 0$ with $n = 18$.

### D149: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_9 &= (1-\rho)\rho^9, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_9 = \lambda & n \geq 0 \\ \mu_9 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.40$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\binom{9+40}{9} = \frac{(9+40)!}{9! \, 40!}$$

A quick check uses $f(x) = x^{2} + 9x + 40$ and $e^{i\pi} + 1 = 0$ with $n = 9$.

### D150: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{23} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 4 & 8 & 0 \\ 3 & 4 & 5 \\ 0 & 1 & 4 \end{pmatrix}$$

Strict diagonal dominance with $N = 23$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $T(n) = 2 T\left(\frac23{2}\right) + \Theta(n)$ and $e^{i\pi} + 1 = 0$ with $n = 23$.

### D151: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 9 \pmod{23} \\ x &\equiv \pm r \pmod{23} \\ N &= 1 + \left(\frac{9}{23}\right)
\end{aligned}$$

$$\begin{pmatrix} 9 & 1 \\ 0 & 23 \end{pmatrix}$$

The Legendre symbol $\left(\frac{9}{23}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\det\left(I_{31} + uv^{T}\right) = 1 + v^{T}u$$

A quick check uses $a_{n+1} = a_31 + d$ and $a_{n+1} = a_31 + d$ with $n = 31$.

### D152: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{6 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 6+\kappa & -\kappa \\ -\kappa & 6+\kappa \end{bmatrix}$$

With $\kappa = 6$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 6$ cycles.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ and $E = mc^{2}$ with $n = 6$.

### D153: least squares

Fitting a line by least squares reduces to one symmetric positive definite system, solved once by Cholesky factorization.

$$\begin{aligned}
\min_{\beta} \lVert y - X\beta \rVert_{2}^{2} &\Rightarrow X^{T}X\beta = X^{T}y \\ \hat{\beta} &= (X^{T}X)^{-1}X^{T}y \\ \operatorname{Var}(\hat{\beta}) &= \sigma^{2}(X^{T}X)^{-1}
\end{aligned}$$

$$\begin{vmatrix} 7 & 7 \\ 1 & 6 \end{vmatrix} = 76 - 71$$

The residual norm $\lVert r \rVert_{2}^{2}$ with $N = 38$ degrees of freedom estimates $\sigma^{2}$ without bias.

$$\left\| \sum_{k=1}^{38} \frac{A^4}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{38+1}}{(38+1)!} e^{\lVert A \rVert}$$

A quick check uses $e^{i\pi} + 1 = 0$ and $\lVert v \rVert_{2} = \sqrt{v_{1}^{2} + v_{2}^{2}}$ with $n = 38$.

### D154: Fourier series

A sawtooth wave expands into odd harmonics with alternating signs. Partial sums overshoot near the jump by a fixed ratio.

$$\begin{aligned}
f(t) &= \frac{2}{\pi} \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}2 \sin(k t) \\ S_{N}(t) &= \sum_{k=1}^{N} c_2 e^{ikt} \\ \lim_{N \to \infty} S_{N}(t) &= \frac{f(t^{+}) + f(t^{-})}{2}
\end{aligned}$$

$$\begin{matrix} c_{-19} & \cdots & c_{0} & \cdots & c_{19} \end{matrix}$$

Gibbs overshoot approaches 31 percent of the jump and never vanishes, no matter how large $N$ grows.

$$\left\| \sum_{k=1}^{19} \frac{A^2}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{19+1}}{(19+1)!} e^{\lVert A \rVert}$$

A quick check uses $T(n) = 2 T\left(\frac19{2}\right) + \Theta(n)$ and $E = mc^{2}$ with $n = 19$.

### D155: queueing delay

An M/M/1 queue with arrival rate below service rate reaches a geometric steady state. Little's law links the means.

$$\begin{aligned}
\pi_26 &= (1-\rho)\rho^26, \quad \rho = \frac{\lambda}{\mu} \\ L &= \frac{\rho}{1-\rho} \\ W &= \frac{L}{\lambda} = \frac{1}{\mu - \lambda}
\end{aligned}$$

$$\begin{cases} \lambda_26 = \lambda & n \geq 0 \\ \mu_26 = \mu & n \geq 1 \end{cases}$$

At $\rho = 0.10$ the mean wait is $\frac{1}{1-\rho}$ service times, so small headroom buys large latency wins.

$$\binom{26+10}{26} = \frac{(26+10)!}{26! \, 10!}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ with $n = 26$.

### D156: eigenvalue bounds

Gershgorin discs localize every eigenvalue using only row sums. The proof fits in a few lines and needs no determinants.

$$\begin{aligned}
|\lambda - a_{ii}| &\leq \sum_{j \neq i} |a_{ij}| \\ \lambda &\in \bigcup_{i=1}^{13} D(a_{ii}, R_{i}) \\ \rho(A) &\leq \max_{i} \sum_{j} |a_{ij}|
\end{aligned}$$

$$\begin{pmatrix} 2 & 1 & 0 \\ 6 & 1 & 1 \\ 0 & 1 & 2 \end{pmatrix}$$

Strict diagonal dominance with $N = 13$ rows forces $\det A \neq 0$, which certifies the solver before it runs.

$$\left\| \sum_{k=1}^{13} \frac{A^4}{k!} - e^{A} \right\| \leq \frac{\lVert A \rVert^{13+1}}{(13+1)!} e^{\lVert A \rVert}$$

A quick check uses $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ and $P(A \mid B) = \frac{P(B \mid A) P(A)}{P(B)}$ with $n = 13$.

### D157: quadratic residues

We count solutions to a congruence by lifting roots from a prime modulus, keeping every step explicit so the count stays exact.

$$\begin{aligned}
x^{2} &\equiv 3 \pmod{2} \\ x &\equiv \pm r \pmod{2} \\ N &= 1 + \left(\frac{3}{2}\right)
\end{aligned}$$

$$\begin{pmatrix} 3 & 1 \\ 0 & 2 \end{pmatrix}$$

The Legendre symbol $\left(\frac{3}{2}\right)$ decides the count, and Hensel lifting carries each root to higher powers without loss.

$$\operatorname{erf}(x) = \frac{2}{\sqrt{\pi}} \int_{0}^{x} e^{-t^{2}} \, dt$$

A quick check uses $T(n) = 2 T\left(\frac17{2}\right) + \Theta(n)$ and $a_{n+1} = a_17 + d$ with $n = 17$.

### D158: coupled oscillators

Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly.

$$\begin{aligned}
m \ddot{x}_{1} &= -k x_{1} + \kappa (x_{2} - x_{1}) \\ m \ddot{x}_{2} &= -k x_{2} - \kappa (x_{2} - x_{1}) \\ \omega_{\pm}^{2} &= \frac{12 \pm \kappa}{m}
\end{aligned}$$

$$\begin{bmatrix} 12+\kappa & -\kappa \\ -\kappa & 12+\kappa \end{bmatrix}$$

With $\kappa = 12$ the splitting equals $\Delta \omega \approx \frac{\kappa}{m \omega_{0}}$, visible after roughly $N = 5$ cycles.

$$\sum_{n=1}^{\infty} \frac{(-1)^{n+1}}{n^{35}} = \left(1 - 2^{1-35}\right) \zeta(35)$$

A quick check uses $\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_{i} - \mu)^{2}}$ and $f(x) = x^{2} + 5x + 35$ with $n = 5$.

