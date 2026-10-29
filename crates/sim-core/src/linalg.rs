//! Sistema G·v = i denso, resolvido por eliminação de Gauss com pivotamento parcial.
//! Os circuitos do AutoBlue têm dezenas de nós, então denso é mais que suficiente.

pub struct System {
    m: usize,
    g: Vec<f64>,
    i: Vec<f64>,
}

impl System {
    pub fn new(m: usize) -> Self {
        Self {
            m,
            g: vec![0.0; m * m],
            i: vec![0.0; m],
        }
    }

    /// Soma em G[row][col], com nós numerados a partir de 1 (o nó 0 é a referência e some).
    pub fn add_g(&mut self, row: usize, col: usize, val: f64) {
        if row > 0 && col > 0 {
            self.g[(row - 1) * self.m + col - 1] += val;
        }
    }

    pub fn add_i(&mut self, row: usize, val: f64) {
        if row > 0 {
            self.i[row - 1] += val;
        }
    }

    pub fn solve(mut self) -> Option<Vec<f64>> {
        let m = self.m;
        for col in 0..m {
            let pivot = (col..m).max_by(|&a, &b| {
                self.g[a * m + col]
                    .abs()
                    .total_cmp(&self.g[b * m + col].abs())
            })?;
            if self.g[pivot * m + col].abs() < 1e-300 {
                return None;
            }
            if pivot != col {
                for k in 0..m {
                    self.g.swap(col * m + k, pivot * m + k);
                }
                self.i.swap(col, pivot);
            }
            let d = self.g[col * m + col];
            for row in col + 1..m {
                let f = self.g[row * m + col] / d;
                if f == 0.0 {
                    continue;
                }
                for k in col..m {
                    self.g[row * m + k] -= f * self.g[col * m + k];
                }
                self.i[row] -= f * self.i[col];
            }
        }
        let mut x = vec![0.0; m];
        for row in (0..m).rev() {
            let mut sum = self.i[row];
            for k in row + 1..m {
                sum -= self.g[row * m + k] * x[k];
            }
            x[row] = sum / self.g[row * m + row];
        }
        x.iter().all(|v| v.is_finite()).then_some(x)
    }
}
