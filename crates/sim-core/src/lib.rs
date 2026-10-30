//! Simulador do AutoBlue: ponto de operação (DC) e simulação no tempo (transiente).
//!
//! Análise nodal: uma incógnita por nó (o nó 0 é a referência, 0 V). Fontes são
//! modeladas como Thévenin (tensão + resistência interna > 0), o que dispensa
//! linhas extras de corrente e deixa qualquer curto-circuito com resposta finita.
//! Elementos não lineares (diodos, transistores, reguladores) são resolvidos por
//! Newton-Raphson; se não convergir direto, tenta gmin stepping e depois source stepping.
//!
//! No transiente, capacitores e indutores viram "modelos companheiros" de Euler
//! implícito: a cada passo `dt`, um capacitor é uma condutância C/dt em paralelo com
//! uma fonte de corrente que lembra a tensão anterior. Euler implícito é estável
//! mesmo com passos grandes, o que importa num simulador interativo.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

mod linalg;
#[cfg(target_arch = "wasm32")]
mod wasm;

/// Tensão térmica a ~27 °C.
pub const VT: f64 = 0.025852;
/// Condutância mínima de cada nó para a referência: mantém nós soltos definidos.
const GMIN: f64 = 1e-12;
const MAX_ITER: usize = 200;
/// Último recurso do transiente, do menor para o maior (em S). Numa virada regenerativa, dois
/// transistores sem capacitâncias não têm solução contínua: a raiz estável some e o circuito
/// real pula para outro estado. Capacitância parasita nos nós dá tempo finito a esse pulo.
const PARASITIC: [f64; 4] = [1e-3, 1e-2, 1e-1, 1.0];
/// Acima disso a exponencial dos transistores vira reta (evita overflow no Newton).
const XMAX: f64 = 40.0;
/// Nos diodos a reta começa nesta corrente (A), não num expoente fixo: um LED azul
/// tem Is ~1e-26 e conduz normalmente bem acima de e^40.
const I_LIN: f64 = 100.0;
/// Maior passo de tensão por iteração, em volts.
const MAX_STEP: f64 = 2.0;
/// Um indutor em DC é um fio: 1 mΩ.
const INDUCTOR_DC_G: f64 = 1e3;
/// Condutância do canal de um MOSFET desligado: fuga de ~10 nA a 10 V, na ordem dos datasheets.
const G_OFF: f64 = 1e-9;

#[derive(Debug, Clone, Deserialize)]
pub struct Circuit {
    /// Quantidade de nós externos; o nó 0 é a referência.
    pub nodes: usize,
    pub elements: Vec<Element>,
    /// Nós preferidos como referência de partes isoladas do circuito (ex.: GND).
    #[serde(default)]
    pub prefer_ref: Vec<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Element {
    Resistor {
        id: String,
        a: usize,
        b: usize,
        r: f64,
    },
    /// Fonte de tensão com resistência interna (equivalente de Thévenin).
    Source {
        id: String,
        p: usize,
        n: usize,
        v: f64,
        r: f64,
    },
    /// Fonte de bancada: tensão constante (CV) até `ilim`, depois corrente constante (CC).
    Supply {
        id: String,
        p: usize,
        n: usize,
        v: f64,
        r: f64,
        ilim: f64,
    },
    /// Diodo de Shockley com resistência série opcional.
    Diode {
        id: String,
        a: usize,
        k: usize,
        is: f64,
        n: f64,
        rs: f64,
    },
    /// Transistor NPN, modelo de Ebers-Moll (transporte).
    Npn {
        id: String,
        c: usize,
        b: usize,
        e: usize,
        is: f64,
        bf: f64,
        br: f64,
    },
    /// MOSFET canal N, lei quadrática com transição suave no limiar.
    Nmos {
        id: String,
        d: usize,
        g: usize,
        s: usize,
        k: f64,
        vth: f64,
    },
    /// Em DC, não conduz. No transiente, carrega e descarrega.
    Capacitor {
        id: String,
        a: usize,
        b: usize,
        #[serde(default)]
        c: f64,
    },
    /// Em DC, é um fio. No transiente, resiste a mudanças de corrente. `rs` = resistência do fio.
    Inductor {
        id: String,
        a: usize,
        b: usize,
        l: f64,
        rs: f64,
    },
    /// Transistor PNP: o NPN espelhado (tensões e correntes com sinal trocado).
    Pnp {
        id: String,
        c: usize,
        b: usize,
        e: usize,
        is: f64,
        bf: f64,
        br: f64,
    },
    /// MOSFET canal P: o canal N espelhado. `vth` é o módulo do limiar.
    Pmos {
        id: String,
        d: usize,
        g: usize,
        s: usize,
        k: f64,
        vth: f64,
    },
    /// Lógica digital (portas, flip-flop, contador). A saída é um push-pull entre VCC e GND.
    /// No transiente, ela reage às entradas do passo anterior: é o atraso de propagação.
    Logic {
        id: String,
        kind: String,
        vcc: usize,
        gnd: usize,
        ins: Vec<usize>,
        outs: Vec<usize>,
        rout: f64,
        /// Pequeno desvio no limiar de cada porta, como nos chips de verdade.
        #[serde(default)]
        skew: f64,
    },
    /// Temporizador 555: divisor interno de 3 × 5 kΩ, dois comparadores, um latch,
    /// saída push-pull e transistor de descarga.
    Timer555 {
        id: String,
        gnd: usize,
        trig: usize,
        out: usize,
        reset: usize,
        ctrl: usize,
        thresh: usize,
        dis: usize,
        vcc: usize,
    },
    /// Regulador linear: mantém `vref` na saída enquanto a entrada tiver folga (`dropout`).
    Regulator {
        id: String,
        #[serde(rename = "in")]
        inp: usize,
        gnd: usize,
        out: usize,
        vref: f64,
        dropout: f64,
        iq: f64,
        ilim: f64,
        rout: f64,
    },
}

impl Element {
    fn id(&self) -> &str {
        match self {
            Element::Resistor { id, .. }
            | Element::Source { id, .. }
            | Element::Supply { id, .. }
            | Element::Diode { id, .. }
            | Element::Npn { id, .. }
            | Element::Nmos { id, .. }
            | Element::Pnp { id, .. }
            | Element::Pmos { id, .. }
            | Element::Logic { id, .. }
            | Element::Timer555 { id, .. }
            | Element::Capacitor { id, .. }
            | Element::Inductor { id, .. }
            | Element::Regulator { id, .. } => id,
        }
    }

    /// Terminais externos, na ordem em que as correntes são reportadas.
    fn terminals(&self) -> Vec<usize> {
        if let Element::Logic {
            vcc,
            gnd,
            ins,
            outs,
            ..
        } = self
        {
            return [*vcc, *gnd]
                .into_iter()
                .chain(outs.iter().copied())
                .chain(ins.iter().copied())
                .collect();
        }
        match *self {
            Element::Resistor { a, b, .. }
            | Element::Capacitor { a, b, .. }
            | Element::Inductor { a, b, .. } => vec![a, b],
            Element::Source { p, n, .. } | Element::Supply { p, n, .. } => vec![p, n],
            Element::Diode { a, k, .. } => vec![a, k],
            Element::Npn { c, b, e, .. } | Element::Pnp { c, b, e, .. } => vec![c, b, e],
            Element::Nmos { d, g, s, .. } | Element::Pmos { d, g, s, .. } => vec![d, g, s],
            Element::Timer555 {
                gnd,
                trig,
                out,
                reset,
                ctrl,
                thresh,
                dis,
                vcc,
                ..
            } => {
                vec![gnd, trig, out, reset, ctrl, thresh, dis, vcc]
            }
            Element::Logic { .. } => unreachable!(),
            Element::Regulator { inp, gnd, out, .. } => vec![inp, gnd, out],
        }
    }

    fn dynamic(&self) -> bool {
        matches!(
            self,
            Element::Capacitor { .. }
                | Element::Inductor { .. }
                | Element::Logic { .. }
                | Element::Timer555 { .. }
        )
    }
}

#[derive(Debug, Serialize)]
pub struct Solution {
    pub converged: bool,
    pub iterations: usize,
    pub strategy: &'static str,
    /// Tensão de cada nó externo.
    pub voltages: Vec<f64>,
    pub elements: Vec<ElementResult>,
}

#[derive(Debug, Serialize)]
pub struct ElementResult {
    pub id: String,
    /// Corrente entrando no elemento por cada terminal (soma zero).
    pub currents: Vec<f64>,
    /// Potência absorvida, em watts. Negativa = o elemento está entregando energia.
    pub power: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<&'static str>,
}

/// Pedido de simulação no tempo: avança `duration` segundos em `steps` passos.
#[derive(Debug, Clone, Deserialize)]
pub struct TransientRequest {
    pub circuit: Circuit,
    /// Estado guardado: tensão de cada capacitor e corrente de cada indutor (por id).
    /// O que faltar começa em zero (capacitor descarregado).
    #[serde(default)]
    pub state: HashMap<String, f64>,
    pub duration: f64,
    pub steps: usize,
    /// Tensões do quadro anterior, para o Newton começar perto da resposta.
    #[serde(default)]
    pub guess: Vec<f64>,
    /// Nós cujas tensões são gravadas a cada passo (osciloscópio).
    #[serde(default)]
    pub probes: Vec<usize>,
    #[serde(default)]
    pub t0: f64,
}

#[derive(Debug, Serialize)]
pub struct TransientResult {
    /// Situação no fim do intervalo.
    pub solution: Solution,
    pub state: HashMap<String, f64>,
    /// Uma linha por passo: [t, tensão de cada nó de `probes`].
    pub samples: Vec<Vec<f64>>,
    /// Nada mais está mudando: dá para parar de simular até a próxima mudança.
    pub settled: bool,
}

/// Exponencial que vira reta acima de `xmax`. Retorna (valor, derivada).
fn limexp(x: f64, xmax: f64) -> (f64, f64) {
    if x < xmax {
        let e = x.exp();
        (e, e)
    } else {
        let e = xmax.exp();
        (e * (1.0 + x - xmax), e)
    }
}

/// s·ln(1 + e^(x/s)): rampa suave que vale ~0 abaixo de 0 e ~x acima.
fn softplus(x: f64, s: f64) -> (f64, f64) {
    let u = x / s;
    if u > 30.0 {
        (x, 1.0)
    } else {
        let e = u.exp();
        (s * e.ln_1p(), e / (1.0 + e))
    }
}

/// Bloco linearizado: correntes `f` entrando pelos nós e jacobiano `j[k][m] = ∂f_k/∂v_m`.
struct Block {
    nodes: Vec<usize>,
    f: Vec<f64>,
    j: Vec<Vec<f64>>,
}

fn conductance(a: usize, b: usize, g: f64, v: &[f64], offset: f64) -> Block {
    let i = g * (v[a] - v[b]) - offset;
    Block {
        nodes: vec![a, b],
        f: vec![i, -i],
        j: vec![vec![g, -g], vec![-g, g]],
    }
}

fn junction(a: usize, k: usize, is: f64, n: f64, v: &[f64]) -> Block {
    let nvt = n * VT;
    let (e, de) = limexp((v[a] - v[k]) / nvt, XMAX.max((I_LIN / is).ln()));
    let i = is * (e - 1.0);
    let g = is * de / nvt;
    Block {
        nodes: vec![a, k],
        f: vec![i, -i],
        j: vec![vec![g, -g], vec![-g, g]],
    }
}

/// Bloco comportamental com jacobiano numérico (diferença central).
fn numeric(nodes: Vec<usize>, v: &[f64], f: impl Fn(&[f64]) -> Vec<f64>) -> Block {
    let at: Vec<f64> = nodes.iter().map(|&n| v[n]).collect();
    let base = f(&at);
    let n = nodes.len();
    let h = 1e-6;
    let mut j = vec![vec![0.0; n]; n];
    for c in 0..n {
        let (mut up, mut dn) = (at.clone(), at.clone());
        up[c] += h;
        dn[c] -= h;
        let (fu, fd) = (f(&up), f(&dn));
        for r in 0..n {
            j[r][c] = (fu[r] - fd[r]) / (2.0 * h);
        }
    }
    Block { nodes, f: base, j }
}

/// Correntes entrando no regulador por (entrada, terra, saída).
#[allow(clippy::too_many_arguments)]
fn regulator(x: &[f64], vref: f64, dropout: f64, iq: f64, ilim: f64, rout: f64) -> Vec<f64> {
    let (vi, vg, vo) = (x[0], x[1], x[2]);
    let head = vi - vg;
    // Mínimo suave entre a referência e o que a entrada permite.
    let target = vg + vref - softplus(vref - (head - dropout), 0.02).0;
    let want = (target - vo) / rout;
    // Só fornece corrente (não absorve) e até o limite. Acima do limite sobra 0,01% da
    // inclinação: com as duas pontas planas o Newton pula de um extremo ao outro sem parar.
    let si = 1e-4;
    let pos = softplus(want, si).0;
    let out = pos - 0.9999 * softplus(pos - ilim, si).0;
    let q = iq / (1.0 + (-(head - 1.0) / 0.1).exp());
    vec![out + q, -q, -out]
}

type Eval3 = ([f64; 3], [[f64; 3]; 3]);

/// NPN de Ebers-Moll: correntes entrando por (c, b, e) e o jacobiano.
fn npn_eval(vc: f64, vb: f64, ve: f64, is: f64, bf: f64, br: f64) -> Eval3 {
    let (ef, def) = limexp((vb - ve) / VT, XMAX);
    let (er, der) = limexp((vb - vc) / VT, XMAX);
    let icc = is * (ef - 1.0);
    let iec = is * (er - 1.0);
    let gf = is * def / VT;
    let gr = is * der / VT;
    let kr = 1.0 + 1.0 / br;
    let ic = icc - iec * kr;
    let ib = icc / bf + iec / br;
    // Derivadas em relação a vbe e vbc, convertidas para (vc, vb, ve).
    let row = |d_be: f64, d_bc: f64| [-d_bc, d_be + d_bc, -d_be];
    let jc = row(gf, -gr * kr);
    let jb = row(gf / bf, gr / br);
    let je = [-(jc[0] + jb[0]), -(jc[1] + jb[1]), -(jc[2] + jb[2])];
    ([ic, ib, -(ic + ib)], [jc, jb, je])
}

/// MOSFET canal N: correntes entrando por (d, g, s) e o jacobiano.
fn nmos_eval(vd: f64, vg: f64, vs: f64, k: f64, vth: f64) -> Eval3 {
    // Simétrico: se vds < 0, dreno e fonte trocam de papel.
    let swapped = vd < vs;
    let (vdd, vss) = if swapped { (vs, vd) } else { (vd, vs) };
    let vds = vdd - vss;
    let (vov, dvov) = softplus(vg - vss - vth, 2.0 * 1.5 * VT);
    const LAMBDA: f64 = 0.01;
    let cl = 1.0 + LAMBDA * vds;
    let (id, did_ov, did_ds) = if vds < vov {
        let core = vov * vds - vds * vds / 2.0;
        (
            k * core * cl,
            k * vds * cl,
            k * (vov - vds) * cl + k * core * LAMBDA,
        )
    } else {
        let core = vov * vov / 2.0;
        (k * core * cl, k * vov * cl, k * core * LAMBDA)
    };
    // Sem essa fuga, o nó entre dois MOSFETs desligados em série não teria tensão definida.
    let (id, did_ds) = (id + G_OFF * vds, did_ds + G_OFF);
    let gm = did_ov * dvov;
    // Corrente entrando pelo dreno efetivo em função de (v_dd, v_g, v_ss).
    let r = [did_ds, gm, -(gm + did_ds)];
    let neg = [-r[0], -r[1], -r[2]];
    if swapped {
        // Colunas estão em (v_s, v_g, v_d): reordena para (d, g, s).
        (
            [-id, 0.0, id],
            [[neg[2], neg[1], neg[0]], [0.0; 3], [r[2], r[1], r[0]]],
        )
    } else {
        ([id, 0.0, -id], [r, [0.0; 3], neg])
    }
}

/// Versão canal P / PNP: f_p(v) = −f_n(−v), e o jacobiano fica igual.
fn mirror((f, j): Eval3) -> Eval3 {
    (f.map(|x| -x), j)
}

fn block3(nodes: [usize; 3], (f, j): Eval3) -> Block {
    Block {
        nodes: nodes.to_vec(),
        f: f.to_vec(),
        j: j.iter().map(|r| r.to_vec()).collect(),
    }
}

/// Nível lógico de uma entrada CMOS, 0–1, com transição suave perto de VCC/2.
fn level(v: f64, vg: f64, vcc: f64, skew: f64) -> f64 {
    let span = vcc - vg;
    if span < 0.5 {
        return 0.0;
    }
    let u = ((v - vg) / span - 0.5 - skew) / 0.05;
    1.0 / (1.0 + (-u).exp())
}

/// Portas combinacionais (níveis contínuos 0–1). None = elemento sequencial.
fn gate(kind: &str, x: &[f64]) -> Option<f64> {
    let a = x.first().copied().unwrap_or(0.0);
    let b = x.get(1).copied().unwrap_or(0.0);
    Some(match kind {
        "not" => 1.0 - a,
        "buf" => a,
        "and" => a * b,
        "nand" => 1.0 - a * b,
        "or" => a + b - a * b,
        "nor" => (1.0 - a) * (1.0 - b),
        "xor" => a + b - 2.0 * a * b,
        _ => return None,
    })
}

/// Saídas de um elemento sequencial antes do primeiro passo.
fn initial_outputs(kind: &str, n: usize) -> Vec<f64> {
    match kind {
        "dff" => vec![0.0, 1.0],
        // 4017: começa no Q0, com o "carry out" alto (contagem < 5).
        "decade" => (0..n)
            .map(|i| if i == 0 || i == 10 { 1.0 } else { 0.0 })
            .collect(),
        _ => vec![0.0; n],
    }
}

fn key(id: &str, part: &str) -> String {
    format!("{id}#{part}")
}

/// Um passo de um elemento sequencial: lê as entradas, atualiza o estado, devolve as saídas.
fn sequential(
    kind: &str,
    id: &str,
    x: &[f64],
    prev: &HashMap<String, f64>,
    next: &mut HashMap<String, f64>,
) -> Vec<f64> {
    let get = |name: &str, default: f64| prev.get(&key(id, name)).copied().unwrap_or(default);
    let hi = |i: usize| x.get(i).copied().unwrap_or(0.0) > 0.5;
    match kind {
        // 74HC74: entradas (D, CLK, /CLR, /PRE); saídas (Q, /Q).
        "dff" => {
            let mut q = get("q", 0.0);
            let clk = hi(1);
            let (clr, pre) = (!hi(2), !hi(3));
            if clr {
                q = 0.0;
            } else if pre {
                q = 1.0;
            } else if clk && get("clk", 0.0) < 0.5 {
                q = if hi(0) { 1.0 } else { 0.0 };
            }
            next.insert(key(id, "q"), q);
            next.insert(key(id, "clk"), if clk { 1.0 } else { 0.0 });
            if clr && pre {
                vec![1.0, 1.0]
            } else {
                vec![q, 1.0 - q]
            }
        }
        // CD4017: entradas (CLK, INH, RST); saídas Q0–Q9 e CO.
        "decade" => {
            let mut count = get("n", 0.0);
            let clk = hi(0);
            if hi(2) {
                count = 0.0;
            } else if clk && get("clk", 0.0) < 0.5 && !hi(1) {
                count = (count + 1.0) % 10.0;
            }
            next.insert(key(id, "n"), count);
            next.insert(key(id, "clk"), if clk { 1.0 } else { 0.0 });
            let mut out: Vec<f64> = (0..10)
                .map(|i| if count as usize == i { 1.0 } else { 0.0 })
                .collect();
            out.push(if count < 5.0 { 1.0 } else { 0.0 });
            out
        }
        _ => vec![],
    }
}

/// Saída push-pull: chave para VCC com condutância L/rout e para GND com (1−L)/rout.
fn push_pull(vcc: usize, gnd: usize, out: usize, l: f64, rout: f64, v: &[f64]) -> [Block; 2] {
    let l = l.clamp(0.0, 1.0);
    [
        conductance(vcc, out, (l + 1e-6) / rout, v, 0.0),
        conductance(out, gnd, (1.0 - l + 1e-6) / rout, v, 0.0),
    ]
}

/// Valores do 555.
const R555: f64 = 5000.0;
const ROUT555: f64 = 10.0;
/// Saída alta: ~1,4 V abaixo do VCC sem carga, ~1,7 V com 100 mA (datasheet).
const VDROP555: f64 = 1.4;
const ROUT555_HI: f64 = 3.0;

enum Analysis<'a> {
    Dc,
    Tran {
        dt: f64,
        prev: &'a HashMap<String, f64>,
    },
}

struct Prepared<'a> {
    c: &'a Circuit,
    /// Total de nós, incluindo internos (resistência série de diodos e indutores).
    n: usize,
    internal: Vec<Option<usize>>,
    /// Nós amarrados à referência (um por parte isolada do circuito).
    ties: Vec<usize>,
}

fn prepare(c: &Circuit) -> Prepared<'_> {
    let mut n = c.nodes.max(1);
    let internal = c
        .elements
        .iter()
        .map(|e| match e {
            Element::Diode { rs, .. } | Element::Inductor { rs, .. } if *rs > 0.0 => {
                n += 1;
                Some(n - 1)
            }
            // Ponto de ⅓ VCC do divisor interno do 555.
            Element::Timer555 { .. } => {
                n += 1;
                Some(n - 1)
            }
            _ => None,
        })
        .collect();

    // Partes do circuito sem caminho até o nó 0 ganham uma referência própria.
    // Como estão isoladas, nenhuma corrente passa por essa amarração.
    let mut parent: Vec<usize> = (0..c.nodes.max(1)).collect();
    fn find(p: &mut [usize], x: usize) -> usize {
        let mut r = x;
        while p[r] != r {
            p[r] = p[p[r]];
            r = p[r];
        }
        r
    }
    for e in &c.elements {
        let t = e.terminals();
        for w in t.windows(2) {
            let (a, b) = (find(&mut parent, w[0]), find(&mut parent, w[1]));
            parent[a] = b;
        }
    }
    let ground = find(&mut parent, 0);
    let mut seen = std::collections::HashSet::from([ground]);
    let mut ties = Vec::new();
    let candidates = c.prefer_ref.iter().copied().chain(1..c.nodes);
    for node in candidates.filter(|&x| x < c.nodes) {
        let root = find(&mut parent, node);
        if seen.insert(root) {
            ties.push(node);
        }
    }
    Prepared {
        c,
        n,
        internal,
        ties,
    }
}

struct State {
    v: Vec<f64>,
    /// Fonte de bancada em modo corrente constante?
    cc: Vec<bool>,
}

fn blocks(p: &Prepared, s: &State, scale: f64, an: &Analysis) -> Vec<(usize, Block)> {
    let v = &s.v;
    let mut out: Vec<(usize, Block)> = Vec::new();
    for (idx, e) in p.c.elements.iter().enumerate() {
        let mut push = |b: Block| out.push((idx, b));
        match *e {
            Element::Resistor { a, b, r, .. } => push(conductance(a, b, 1.0 / r.max(1e-6), v, 0.0)),
            Element::Source {
                p: pp, n, v: vs, r, ..
            } => {
                let g = 1.0 / r.max(1e-6);
                push(conductance(pp, n, g, v, g * vs * scale));
            }
            Element::Supply {
                p: pp,
                n,
                v: vs,
                r,
                ilim,
                ..
            } => {
                if s.cc[idx] {
                    // Corrente constante: injeta ilim no + (com uma fuga mínima).
                    push(conductance(pp, n, 1e-6, v, ilim * scale));
                } else {
                    let g = 1.0 / r.max(1e-6);
                    push(conductance(pp, n, g, v, g * vs * scale));
                }
            }
            Element::Diode {
                a, k, is, n, rs, ..
            } => match p.internal[idx] {
                Some(m) => {
                    push(conductance(a, m, 1.0 / rs, v, 0.0));
                    push(junction(m, k, is, n, v));
                }
                None => push(junction(a, k, is, n, v)),
            },
            Element::Npn {
                c,
                b,
                e,
                is,
                bf,
                br,
                ..
            } => {
                push(block3([c, b, e], npn_eval(v[c], v[b], v[e], is, bf, br)));
            }
            Element::Pnp {
                c,
                b,
                e,
                is,
                bf,
                br,
                ..
            } => {
                push(block3(
                    [c, b, e],
                    mirror(npn_eval(-v[c], -v[b], -v[e], is, bf, br)),
                ));
            }
            Element::Nmos {
                d,
                g,
                s: src,
                k,
                vth,
                ..
            } => {
                push(block3([d, g, src], nmos_eval(v[d], v[g], v[src], k, vth)));
            }
            Element::Pmos {
                d,
                g,
                s: src,
                k,
                vth,
                ..
            } => {
                push(block3(
                    [d, g, src],
                    mirror(nmos_eval(-v[d], -v[g], -v[src], k, vth)),
                ));
            }
            Element::Logic {
                ref id,
                ref kind,
                vcc,
                gnd,
                ref ins,
                ref outs,
                rout,
                skew,
            } => {
                let comb = gate(kind, &[]).is_some();
                match an {
                    // Em DC, portas combinacionais respondem na hora (não há "antes").
                    Analysis::Dc if comb => {
                        let nodes: Vec<usize> = [vcc, gnd, outs[0]]
                            .into_iter()
                            .chain(ins.iter().copied())
                            .collect();
                        let kind = kind.clone();
                        push(numeric(nodes, v, move |x| {
                            let lv: Vec<f64> = x[3..]
                                .iter()
                                .map(|&vi| level(vi, x[1], x[0], skew))
                                .collect();
                            let l = gate(&kind, &lv).unwrap_or(0.0).clamp(0.0, 1.0);
                            let ih = (l + 1e-6) / rout * (x[0] - x[2]);
                            let il = (1.0 - l + 1e-6) / rout * (x[1] - x[2]);
                            let mut f = vec![ih, il, -(ih + il)];
                            f.extend(std::iter::repeat_n(0.0, x.len() - 3));
                            f
                        }));
                    }
                    _ => {
                        let init = initial_outputs(kind, outs.len());
                        for (k, &o) in outs.iter().enumerate() {
                            let l = match an {
                                Analysis::Tran { prev, .. } => {
                                    prev.get(&key(id, &format!("o{k}"))).copied()
                                }
                                Analysis::Dc => None,
                            }
                            .unwrap_or(if comb {
                                0.0
                            } else {
                                init[k]
                            });
                            for b in push_pull(vcc, gnd, o, l, rout, v) {
                                push(b);
                            }
                        }
                    }
                }
            }
            Element::Timer555 {
                ref id,
                gnd,
                out,
                ctrl,
                dis,
                vcc,
                ..
            } => {
                let m = p.internal[idx].expect("555 tem nó interno");
                let g = 1.0 / R555;
                push(conductance(vcc, ctrl, g, v, 0.0));
                push(conductance(ctrl, m, g, v, 0.0));
                push(conductance(m, gnd, g, v, 0.0));
                // Consumo próprio, ~3 mA a 9 V.
                push(conductance(vcc, gnd, 1.0 / 3000.0, v, 0.0));
                let q = match an {
                    Analysis::Tran { prev, .. } => prev.get(&key(id, "q")).copied().unwrap_or(0.0),
                    Analysis::Dc => 0.0,
                };
                let go = 1.0 / ROUT555;
                if q > 0.5 {
                    // Saída alta: estágio bipolar (Darlington) fica abaixo do VCC.
                    let gh = 1.0 / ROUT555_HI;
                    push(conductance(out, vcc, gh, v, -VDROP555 * gh));
                    push(conductance(dis, gnd, GMIN, v, 0.0));
                } else {
                    push(conductance(out, gnd, go, v, 0.1 * go));
                    push(conductance(dis, gnd, 1.0 / 10.0, v, 0.0));
                }
            }
            Element::Capacitor { ref id, a, b, c } => match an {
                Analysis::Tran { dt, prev } if c > 0.0 => {
                    let g = c / dt;
                    let v0 = prev.get(id).copied().unwrap_or(0.0);
                    push(conductance(a, b, g + GMIN, v, g * v0));
                }
                _ => push(conductance(a, b, GMIN, v, 0.0)),
            },
            Element::Inductor {
                ref id,
                a,
                b,
                l,
                rs,
            } => {
                let m = p.internal[idx];
                let mid = m.unwrap_or(a);
                if let Some(m) = m {
                    push(conductance(a, m, 1.0 / rs, v, 0.0));
                }
                match an {
                    Analysis::Tran { dt, prev } if l > 0.0 => {
                        let i0 = prev.get(id).copied().unwrap_or(0.0);
                        push(conductance(mid, b, dt / l, v, -i0));
                    }
                    _ => push(conductance(mid, b, INDUCTOR_DC_G, v, 0.0)),
                }
            }
            Element::Regulator {
                inp,
                gnd,
                out,
                vref,
                dropout,
                iq,
                ilim,
                rout,
                ..
            } => {
                push(numeric(vec![inp, gnd, out], v, |x| {
                    regulator(x, vref, dropout, iq, ilim, rout)
                }));
            }
        }
    }
    out
}

/// Atualiza o modo CV/CC das fontes de bancada. Retorna true se algum mudou.
fn update_modes(p: &Prepared, s: &mut State) -> bool {
    let mut changed = false;
    for (idx, e) in p.c.elements.iter().enumerate() {
        if let Element::Supply {
            p: pp,
            n,
            v,
            r,
            ilim,
            ..
        } = *e
        {
            let vd = s.v[pp] - s.v[n];
            let next = if s.cc[idx] {
                vd < v
            } else {
                (v - vd) / r > ilim
            };
            if next != s.cc[idx] {
                s.cc[idx] = next;
                changed = true;
            }
        }
    }
    changed
}

/// Newton-Raphson. Retorna o número de iterações se convergiu.
///
/// O passo é limitado (`limit`, em volts). Se a direção do passo se inverte de uma
/// iteração para a outra, é sinal de que o Newton está pulando de um lado ao outro
/// de uma transição brusca; o limite cai pela metade até ele acertar o meio.
fn newton(p: &Prepared, s: &mut State, scale: f64, gmin: f64, an: &Analysis) -> Option<usize> {
    newton_anchored(p, s, scale, gmin, 0.0, &[], an)
}

/// Newton com cada nó preso à tensão `start` por uma condutância `anchor`: é o que um capacitor
/// parasita em cada nó faria em um passo de Euler implícito (C = anchor × dt).
fn newton_anchored(p: &Prepared, s: &mut State, scale: f64, gmin: f64, anchor: f64, start: &[f64], an: &Analysis) -> Option<usize> {
    let m = p.n - 1;
    if m == 0 {
        return Some(0);
    }
    let mut limit = MAX_STEP;
    let mut prev_delta = vec![0.0; m];
    for it in 1..=MAX_ITER {
        let mut sys = linalg::System::new(m);
        for node in 1..p.n {
            sys.add_g(node, node, GMIN + gmin + anchor);
            if anchor > 0.0 {
                sys.add_i(node, anchor * start[node]);
            }
        }
        for &t in &p.ties {
            sys.add_g(t, t, 1.0);
        }
        for (_, b) in blocks(p, s, scale, an) {
            for (r, &nr) in b.nodes.iter().enumerate() {
                let mut rhs = -b.f[r];
                for (c, &nc) in b.nodes.iter().enumerate() {
                    sys.add_g(nr, nc, b.j[r][c]);
                    rhs += b.j[r][c] * s.v[nc];
                }
                sys.add_i(nr, rhs);
            }
        }
        let next = sys.solve()?;
        let delta: Vec<f64> = (1..p.n).map(|node| next[node - 1] - s.v[node]).collect();
        let converged = delta
            .iter()
            .zip(&next)
            .all(|(d, x)| d.abs() <= 1e-9 + 1e-6 * x.abs());
        let max_delta = delta.iter().fold(0.0f64, |a, d| a.max(d.abs()));

        let reversal: f64 = delta.iter().zip(&prev_delta).map(|(a, b)| a * b).sum();
        limit = if reversal < 0.0 {
            (limit * 0.5).max(1e-6)
        } else {
            (limit * 1.5).min(MAX_STEP)
        };
        let k = if max_delta > limit {
            limit / max_delta
        } else {
            1.0
        };
        for (node, d) in (1..p.n).zip(&delta) {
            s.v[node] += k * d;
        }
        prev_delta = delta.iter().map(|d| d * k).collect();

        let modes_changed = update_modes(p, s);
        if converged && !modes_changed && k == 1.0 {
            return Some(it);
        }
    }
    None
}

fn report(p: &Prepared, s: &State, an: &Analysis) -> Vec<ElementResult> {
    let v = &s.v;
    let external = p.c.nodes.max(1);
    let mut per: Vec<Vec<Block>> = p.c.elements.iter().map(|_| Vec::new()).collect();
    for (idx, b) in blocks(p, s, 1.0, an) {
        per[idx].push(b);
    }
    p.c.elements
        .iter()
        .zip(per)
        .enumerate()
        .map(|(idx, (e, bs))| {
            // Um bloco só, nos próprios terminais: as correntes são as dele, terminal a terminal
            // (mesmo se dois terminais estiverem no mesmo nó, como numa bateria em curto).
            // Vários blocos: soma por nó; nós internos ficam de fora.
            let terms = e.terminals();
            let mut currents = vec![0.0; terms.len()];
            if let [b] = bs.as_slice()
                && b.nodes == terms
            {
                currents.clone_from(&b.f);
            } else {
                for b in &bs {
                    for (r, &node) in b.nodes.iter().enumerate() {
                        if node >= external {
                            continue;
                        }
                        if let Some(t) = terms.iter().position(|&x| x == node) {
                            currents[t] += b.f[r];
                        }
                    }
                }
            }
            let power = terms.iter().zip(&currents).map(|(&t, &i)| v[t] * i).sum();
            let mode = match e {
                Element::Supply { .. } => Some(if s.cc[idx] { "cc" } else { "cv" }),
                _ => None,
            };
            ElementResult {
                id: e.id().to_string(),
                currents,
                power,
                mode,
            }
        })
        .collect()
}

fn validate(c: &Circuit) -> Result<(), String> {
    let nodes = c.nodes.max(1);
    for e in &c.elements {
        if let Some(&bad) = e.terminals().iter().find(|&&t| t >= nodes) {
            return Err(format!(
                "elemento {} usa o nó {bad}, mas só existem {nodes}",
                e.id()
            ));
        }
    }
    Ok(())
}

/// Ponto de operação em corrente contínua.
pub fn solve(c: &Circuit) -> Result<Solution, String> {
    validate(c)?;
    let nodes = c.nodes.max(1);
    let p = prepare(c);
    let an = Analysis::Dc;
    let fresh = || State {
        v: vec![0.0; p.n],
        cc: vec![false; c.elements.len()],
    };

    let mut s = fresh();
    let mut strategy = "direto";
    let mut result = newton(&p, &mut s, 1.0, 0.0, &an);

    if result.is_none() {
        strategy = "gmin";
        s = fresh();
        let mut ok = true;
        for step in 0..=10 {
            if newton(&p, &mut s, 1.0, 10f64.powi(-2 - step), &an).is_none() {
                ok = false;
                break;
            }
        }
        result = if ok {
            newton(&p, &mut s, 1.0, 0.0, &an)
        } else {
            None
        };
    }

    if result.is_none() {
        strategy = "fontes";
        s = fresh();
        let mut ok = true;
        for step in 1..=20 {
            if newton(&p, &mut s, step as f64 / 20.0, 0.0, &an).is_none() {
                ok = false;
                break;
            }
        }
        result = if ok {
            newton(&p, &mut s, 1.0, 0.0, &an)
        } else {
            None
        };
    }

    Ok(Solution {
        converged: result.is_some(),
        iterations: result.unwrap_or(MAX_ITER),
        strategy,
        voltages: s.v[..nodes].to_vec(),
        elements: report(&p, &s, &an),
    })
}

/// Grava a nova tensão de cada capacitor e a nova corrente de cada indutor.
fn commit_state(
    p: &Prepared,
    s: &State,
    dt: f64,
    prev: &HashMap<String, f64>,
    next: &mut HashMap<String, f64>,
) {
    for (idx, e) in p.c.elements.iter().enumerate() {
        match *e {
            Element::Capacitor { ref id, a, b, .. } => {
                next.insert(id.clone(), s.v[a] - s.v[b]);
            }
            Element::Inductor {
                ref id, a, b, l, ..
            } if l > 0.0 => {
                let mid = p.internal[idx].unwrap_or(a);
                let i0 = prev.get(id).copied().unwrap_or(0.0);
                next.insert(id.clone(), i0 + dt / l * (s.v[mid] - s.v[b]));
            }
            Element::Logic {
                ref id,
                ref kind,
                vcc,
                gnd,
                ref ins,
                skew,
                ..
            } => {
                let x: Vec<f64> = ins
                    .iter()
                    .map(|&n| level(s.v[n], s.v[gnd], s.v[vcc], skew))
                    .collect();
                let outs = match gate(kind, &x) {
                    // Porta: anda metade do caminho até o novo valor a cada passo.
                    Some(target) => {
                        let l0 = prev.get(&key(id, "o0")).copied().unwrap_or(0.0);
                        vec![l0 + 0.5 * (target - l0)]
                    }
                    None => sequential(kind, id, &x, prev, next),
                };
                for (k, l) in outs.into_iter().enumerate() {
                    next.insert(key(id, &format!("o{k}")), l);
                }
            }
            Element::Timer555 {
                ref id,
                gnd,
                trig,
                reset,
                ctrl,
                thresh,
                ..
            } => {
                let m = p.internal[idx].expect("555 tem nó interno");
                let mut q = prev.get(&key(id, "q")).copied().unwrap_or(0.0);
                // RESET manda; depois o disparo (abaixo de ⅓ VCC) vence o limiar (acima de ⅔ VCC).
                if s.v[reset] - s.v[gnd] < 0.7 {
                    q = 0.0;
                } else if s.v[trig] < s.v[m] {
                    q = 1.0;
                } else if s.v[thresh] > s.v[ctrl] {
                    q = 0.0;
                }
                next.insert(key(id, "q"), q);
            }
            _ => {}
        }
    }
}

/// Avança um passo. Se o Newton não convergir, divide o passo em 4, até 3 vezes; no menor
/// passo, acrescenta capacitância parasita nos nós (viradas regenerativas chegam até aqui).
/// Retorna o estado de antes do último subpasso aceito e o tamanho dele (para o relatório).
fn advance(
    p: &Prepared,
    s: &mut State,
    state: &mut HashMap<String, f64>,
    dt: f64,
    depth: u32,
) -> Option<(HashMap<String, f64>, f64, usize)> {
    let prev = state.clone();
    let saved = (s.v.clone(), s.cc.clone());
    if let Some(it) = newton(p, s, 1.0, 0.0, &Analysis::Tran { dt, prev: &prev }) {
        commit_state(p, s, dt, &prev, state);
        return Some((prev, dt, it));
    }
    (s.v, s.cc) = saved;
    if depth >= 3 {
        let an = Analysis::Tran { dt, prev: &prev };
        let start = s.v.clone();
        let it = PARASITIC.iter().find_map(|&g| {
            s.v.clone_from(&start);
            newton_anchored(p, s, 1.0, 0.0, g, &start, &an)
        })?;
        commit_state(p, s, dt, &prev, state);
        return Some((prev, dt, it));
    }
    let mut last = None;
    let mut total = 0;
    for _ in 0..4 {
        let (pv, sub, it) = advance(p, s, state, dt / 4.0, depth + 1)?;
        total += it;
        last = Some((pv, sub));
    }
    last.map(|(pv, sub)| (pv, sub, total))
}

/// Simula `duration` segundos a partir do estado guardado.
pub fn transient(req: &TransientRequest) -> Result<TransientResult, String> {
    let c = &req.circuit;
    validate(c)?;
    let nodes = c.nodes.max(1);
    let p = prepare(c);

    let mut v = vec![0.0; p.n];
    if req.guess.len() == nodes {
        v[..nodes].copy_from_slice(&req.guess);
    }
    let mut s = State {
        v,
        cc: vec![false; c.elements.len()],
    };
    // Só guarda estado de elementos que ainda existem.
    let alive: std::collections::HashSet<&str> = c
        .elements
        .iter()
        .filter(|e| e.dynamic())
        .map(|e| e.id())
        .collect();
    let mut state: HashMap<String, f64> = req
        .state
        .iter()
        .filter(|(k, _)| {
            alive.contains(k.as_str())
                || k.rsplit_once('#')
                    .is_some_and(|(base, _)| alive.contains(base))
        })
        .map(|(k, &x)| (k.clone(), x))
        .collect();

    let steps = req.steps.max(1);
    let dt = (req.duration / steps as f64).max(1e-12);
    let mut samples = Vec::with_capacity(steps);
    let mut converged = true;
    let mut iterations = 0;
    let mut last: (HashMap<String, f64>, f64) = (state.clone(), dt);
    let mut t = req.t0;

    for _ in 0..steps {
        match advance(&p, &mut s, &mut state, dt, 0) {
            Some((prev, sub, it)) => {
                iterations += it;
                last = (prev, sub);
            }
            None => {
                converged = false;
                break;
            }
        }
        t += dt;
        let mut row = vec![t];
        row.extend(
            req.probes
                .iter()
                .map(|&n| s.v.get(n).copied().unwrap_or(0.0)),
        );
        samples.push(row);
    }

    let (prev, sub) = &last;
    let settled = converged
        && state.iter().all(|(id, &x)| {
            let x0 = prev.get(id).copied().unwrap_or(0.0);
            (x - x0).abs() <= 1e-9 + 1e-7 * x.abs()
        });

    Ok(TransientResult {
        solution: Solution {
            converged,
            iterations,
            strategy: "transiente",
            voltages: s.v[..nodes].to_vec(),
            elements: report(&p, &s, &Analysis::Tran { dt: *sub, prev }),
        },
        state,
        samples,
        settled,
    })
}

#[cfg(test)]
mod tests;
