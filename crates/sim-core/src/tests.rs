use super::*;

fn circuit(nodes: usize, elements: Vec<Element>) -> Circuit {
    Circuit {
        nodes,
        elements,
        prefer_ref: vec![],
    }
}

fn r(id: &str, a: usize, b: usize, r: f64) -> Element {
    Element::Resistor {
        id: id.into(),
        a,
        b,
        r,
    }
}

fn src(id: &str, p: usize, n: usize, v: f64, r: f64) -> Element {
    Element::Source {
        id: id.into(),
        p,
        n,
        v,
        r,
    }
}

/// LED vermelho: ~2,0 V a 20 mA (n = 2, Rs = 10 Ω).
fn red_led(id: &str, a: usize, k: usize) -> Element {
    let n = 2.0;
    let is = 0.02 / ((2.0 - 0.02 * 10.0) / (n * VT)).exp();
    Element::Diode {
        id: id.into(),
        a,
        k,
        is,
        n,
        rs: 10.0,
    }
}

fn get<'a>(s: &'a Solution, id: &str) -> &'a ElementResult {
    s.elements.iter().find(|e| e.id == id).unwrap()
}

fn close(a: f64, b: f64, tol: f64) {
    assert!((a - b).abs() <= tol, "esperado {b}, veio {a}");
}

#[test]
fn divisor_de_tensao() {
    // 9 V (r interna 0) → 1k → nó 2 → 2k → GND
    let s = solve(&circuit(
        3,
        vec![
            src("bt", 1, 0, 9.0, 1e-6),
            r("r1", 1, 2, 1000.0),
            r("r2", 2, 0, 2000.0),
        ],
    ))
    .unwrap();
    assert!(s.converged);
    close(s.voltages[2], 6.0, 1e-6);
    close(get(&s, "r1").currents[0], 0.003, 1e-9);
    close(get(&s, "bt").power, -0.027, 1e-6);
}

#[test]
fn resistencia_interna_derruba_a_tensao() {
    // Bateria 9 V com 1,5 Ω alimentando 7,5 Ω: I = 9/9 = 1 A, terminais em 7,5 V.
    let s = solve(&circuit(
        2,
        vec![src("bt", 1, 0, 9.0, 1.5), r("r", 1, 0, 7.5)],
    ))
    .unwrap();
    close(s.voltages[1], 7.5, 1e-6);
    close(get(&s, "bt").currents[0], -1.0, 1e-6);
}

#[test]
fn curto_direto_na_bateria() {
    // + e − no mesmo nó: só a resistência interna limita. I = 9 / 1,5 = 6 A.
    let s = solve(&circuit(1, vec![src("bt", 0, 0, 9.0, 1.5)])).unwrap();
    close(get(&s, "bt").currents[0], -6.0, 1e-9);
}

#[test]
fn led_com_resistor() {
    // 9 V → 330 Ω → LED → GND: I ≈ (9 − ~2) / 330 ≈ 21 mA.
    let s = solve(&circuit(
        3,
        vec![
            src("bt", 1, 0, 9.0, 1.5),
            r("r", 1, 2, 330.0),
            red_led("d", 2, 0),
        ],
    ))
    .unwrap();
    assert!(s.converged);
    let i = get(&s, "d").currents[0];
    assert!((0.019..0.023).contains(&i), "corrente {i}");
    let vf = s.voltages[2];
    assert!((1.9..2.2).contains(&vf), "vf {vf}");
    // Lei de Kirchhoff: a corrente do resistor é a mesma do LED.
    close(get(&s, "r").currents[0], i, 1e-9);
}

#[test]
fn led_ao_contrario_nao_conduz() {
    let s = solve(&circuit(
        3,
        vec![
            src("bt", 1, 0, 9.0, 1.5),
            r("r", 1, 2, 330.0),
            red_led("d", 0, 2),
        ],
    ))
    .unwrap();
    assert!(get(&s, "d").currents[0].abs() < 1e-9);
    close(s.voltages[2], 9.0, 1e-3);
}

#[test]
fn led_direto_na_bateria_puxa_muita_corrente() {
    let s = solve(&circuit(
        2,
        vec![src("bt", 1, 0, 9.0, 1.5), red_led("d", 1, 0)],
    ))
    .unwrap();
    assert!(s.converged);
    assert!(get(&s, "d").currents[0] > 0.3);
}

#[test]
fn fonte_de_bancada_limita_corrente() {
    // 12 V, limite 100 mA, carga 10 Ω: pediria 1,2 A → entra em CC, 100 mA e 1 V.
    let sup = Element::Supply {
        id: "ps".into(),
        p: 1,
        n: 0,
        v: 12.0,
        r: 0.01,
        ilim: 0.1,
    };
    let s = solve(&circuit(2, vec![sup.clone(), r("r", 1, 0, 10.0)])).unwrap();
    assert!(s.converged);
    assert_eq!(get(&s, "ps").mode, Some("cc"));
    close(get(&s, "r").currents[0], 0.1, 1e-6);
    // Carga leve: continua em CV.
    let s = solve(&circuit(2, vec![sup, r("r", 1, 0, 1000.0)])).unwrap();
    assert_eq!(get(&s, "ps").mode, Some("cv"));
    close(s.voltages[1], 12.0, 1e-3);
}

#[test]
fn npn_como_chave() {
    // Vcc 9 V; base por 10 kΩ a partir de 5 V; coletor com 1 kΩ. Satura: Vce pequeno.
    let q = Element::Npn {
        id: "q".into(),
        c: 3,
        b: 4,
        e: 0,
        is: 1e-14,
        bf: 150.0,
        br: 5.0,
    };
    let s = solve(&circuit(
        5,
        vec![
            src("vcc", 1, 0, 9.0, 0.01),
            src("vin", 2, 0, 5.0, 0.01),
            r("rc", 1, 3, 1000.0),
            r("rb", 2, 4, 10_000.0),
            q,
        ],
    ))
    .unwrap();
    assert!(s.converged);
    let vce = s.voltages[3];
    assert!(vce < 0.3, "vce {vce}");
    let vbe = s.voltages[4];
    assert!((0.6..0.8).contains(&vbe), "vbe {vbe}");
    let qr = get(&s, "q");
    close(qr.currents.iter().sum::<f64>(), 0.0, 1e-12);
}

#[test]
fn npn_cortado_sem_base() {
    let q = Element::Npn {
        id: "q".into(),
        c: 2,
        b: 0,
        e: 0,
        is: 1e-14,
        bf: 150.0,
        br: 5.0,
    };
    let s = solve(&circuit(
        3,
        vec![src("vcc", 1, 0, 9.0, 0.01), r("rc", 1, 2, 1000.0), q],
    ))
    .unwrap();
    close(s.voltages[2], 9.0, 1e-3);
}

#[test]
fn mosfet_liga_com_tensao_na_porta() {
    // 12 V → 10 Ω → dreno; porta em 5 V; IRLZ44N-like (k = 13, vth = 1,5).
    let m = |vg: f64| {
        let s = solve(&circuit(
            4,
            vec![
                src("vdd", 1, 0, 12.0, 0.01),
                src("vg", 3, 0, vg, 0.01),
                r("rl", 1, 2, 10.0),
                Element::Nmos {
                    id: "m".into(),
                    d: 2,
                    g: 3,
                    s: 0,
                    k: 13.0,
                    vth: 1.5,
                },
            ],
        ))
        .unwrap();
        assert!(s.converged);
        get(&s, "m").currents[0]
    };
    let on = m(5.0);
    assert!((1.15..1.21).contains(&on), "ligado {on}");
    assert!(m(0.0) < 1e-4, "desligado {}", m(0.0));
}

#[test]
fn mosfet_com_dreno_e_fonte_invertidos_conduz_ao_contrario() {
    let s = solve(&circuit(
        4,
        vec![
            src("vdd", 1, 0, 12.0, 0.01),
            src("vg", 3, 0, 5.0, 0.01),
            r("rl", 1, 2, 10.0),
            Element::Nmos {
                id: "m".into(),
                d: 0,
                g: 3,
                s: 2,
                k: 13.0,
                vth: 1.5,
            },
        ],
    ))
    .unwrap();
    assert!(s.converged);
    let m = get(&s, "m");
    assert!(
        m.currents[2] > 0.5,
        "corrente entrando pela fonte {}",
        m.currents[2]
    );
}

#[test]
fn partes_isoladas_tem_referencia_propria() {
    // Duas malhas sem ligação entre si; a segunda não toca no nó 0.
    let s = solve(&Circuit {
        nodes: 4,
        elements: vec![
            src("a", 1, 0, 5.0, 0.01),
            r("ra", 1, 0, 100.0),
            src("b", 2, 3, 3.0, 0.01),
            r("rb", 2, 3, 100.0),
        ],
        prefer_ref: vec![3],
    })
    .unwrap();
    assert!(s.converged);
    close(s.voltages[3], 0.0, 1e-9);
    close(s.voltages[2], 3.0, 1e-3);
}

#[test]
fn no_solto_nao_quebra() {
    // Resistor com uma ponta no ar.
    let s = solve(&circuit(
        3,
        vec![src("bt", 1, 0, 9.0, 1.5), r("r", 1, 2, 100.0)],
    ))
    .unwrap();
    assert!(s.converged);
    assert!(get(&s, "r").currents[0].abs() < 1e-9);
}

#[test]
fn capacitor_nao_conduz_em_dc() {
    let s = solve(&circuit(
        2,
        vec![
            src("bt", 1, 0, 9.0, 1.5),
            Element::Capacitor {
                id: "c".into(),
                a: 1,
                b: 0,
                c: 100e-6,
            },
        ],
    ))
    .unwrap();
    close(s.voltages[1], 9.0, 1e-6);
}

#[test]
fn rejeita_no_inexistente() {
    assert!(solve(&circuit(2, vec![r("r", 1, 5, 1.0)])).is_err());
}

// ---------- Transiente ----------

fn tran(
    c: Circuit,
    duration: f64,
    steps: usize,
    state: HashMap<String, f64>,
    probes: Vec<usize>,
) -> TransientResult {
    transient(&TransientRequest {
        circuit: c,
        state,
        duration,
        steps,
        guess: vec![],
        probes,
        t0: 0.0,
    })
    .unwrap()
}

fn rc() -> Circuit {
    // 9 V (quase ideal) → 1 kΩ → capacitor de 100 µF → GND. τ = R·C = 0,1 s.
    circuit(
        3,
        vec![
            src("bt", 1, 0, 9.0, 1e-6),
            r("r", 1, 2, 1000.0),
            Element::Capacitor {
                id: "c".into(),
                a: 2,
                b: 0,
                c: 100e-6,
            },
        ],
    )
}

#[test]
fn capacitor_carrega_com_constante_de_tempo_rc() {
    let out = tran(rc(), 0.1, 2000, HashMap::new(), vec![2]);
    assert!(out.solution.converged);
    // Depois de um τ: 63,2% de 9 V = 5,69 V (Euler implícito com 2000 passos: erro < 1%).
    let v = out.state["c"];
    assert!((v - 5.689).abs() < 0.05, "v = {v}");
    assert_eq!(out.samples.len(), 2000);
    assert!(!out.settled);
}

#[test]
fn estado_continua_de_onde_parou() {
    let a = tran(rc(), 0.1, 1000, HashMap::new(), vec![]);
    let half = tran(rc(), 0.05, 500, HashMap::new(), vec![]);
    let b = tran(rc(), 0.05, 500, half.state, vec![]);
    close(a.state["c"], b.state["c"], 1e-9);
}

#[test]
fn capacitor_carregado_estabiliza() {
    let out = tran(rc(), 2.0, 400, HashMap::new(), vec![]);
    close(out.state["c"], 9.0, 1e-3);
    assert!(out.settled);
    // Carregado, não passa corrente.
    assert!(get(&out.solution, "c").currents[0].abs() < 1e-6);
}

#[test]
fn capacitor_descarrega_pelo_resistor() {
    let c = circuit(
        2,
        vec![
            r("r", 1, 0, 1000.0),
            Element::Capacitor {
                id: "c".into(),
                a: 1,
                b: 0,
                c: 100e-6,
            },
        ],
    );
    let out = tran(
        c,
        0.1,
        2000,
        HashMap::from([("c".to_string(), 9.0)]),
        vec![],
    );
    // Depois de um τ: 36,8% de 9 V = 3,31 V.
    assert!(
        (out.state["c"] - 3.311).abs() < 0.05,
        "v = {}",
        out.state["c"]
    );
}

#[test]
fn indutor_atrasa_a_corrente() {
    // 9 V → 10 Ω → indutor de 1 H. τ = L/R = 0,1 s; corrente final 0,9 A.
    let c = circuit(
        3,
        vec![
            src("bt", 1, 0, 9.0, 1e-6),
            r("r", 1, 2, 10.0),
            Element::Inductor {
                id: "l".into(),
                a: 2,
                b: 0,
                l: 1.0,
                rs: 0.0,
            },
        ],
    );
    let out = tran(c, 0.1, 2000, HashMap::new(), vec![]);
    let i = out.state["l"];
    assert!((i - 0.569).abs() < 0.01, "i = {i}");
    close(get(&out.solution, "l").currents[0], i, 1e-6);
}

#[test]
fn indutor_em_dc_e_um_fio() {
    let c = circuit(
        3,
        vec![
            src("bt", 1, 0, 9.0, 1e-6),
            r("r", 1, 2, 10.0),
            Element::Inductor {
                id: "l".into(),
                a: 2,
                b: 0,
                l: 1e-3,
                rs: 0.2,
            },
        ],
    );
    let s = solve(&c).unwrap();
    close(get(&s, "l").currents[0], 9.0 / 10.2, 1e-3);
}

fn reg(id: &str, inp: usize, out: usize, vref: f64, dropout: f64) -> Element {
    Element::Regulator {
        id: id.into(),
        inp,
        gnd: 0,
        out,
        vref,
        dropout,
        iq: 0.005,
        ilim: 1.5,
        rout: 0.05,
    }
}

#[test]
fn regulador_mantem_5v() {
    for vin in [7.5, 9.0, 12.0, 24.0] {
        let c = circuit(
            3,
            vec![
                src("in", 1, 0, vin, 0.01),
                reg("u", 1, 2, 5.0, 2.0),
                r("load", 2, 0, 100.0),
            ],
        );
        let s = solve(&c).unwrap();
        assert!(s.converged);
        assert!(
            (s.voltages[2] - 5.0).abs() < 0.02,
            "vin {vin}: vout {}",
            s.voltages[2]
        );
        // Entrada = carga (50 mA) + corrente de repouso (5 mA).
        close(get(&s, "u").currents[0], 0.055, 1e-3);
    }
}

#[test]
fn regulador_sem_folga_entra_em_dropout() {
    let c = circuit(
        3,
        vec![
            src("in", 1, 0, 6.0, 0.01),
            reg("u", 1, 2, 5.0, 2.0),
            r("load", 2, 0, 100.0),
        ],
    );
    let s = solve(&c).unwrap();
    assert!((s.voltages[2] - 4.0).abs() < 0.05, "vout {}", s.voltages[2]);
}

#[test]
fn regulador_limita_corrente_em_curto() {
    let c = circuit(
        3,
        vec![
            src("in", 1, 0, 12.0, 0.01),
            reg("u", 1, 2, 5.0, 2.0),
            r("short", 2, 0, 0.01),
        ],
    );
    let s = solve(&c).unwrap();
    let i = get(&s, "short").currents[0];
    assert!((i - 1.5).abs() < 0.01, "i = {i}");
}

#[test]
fn led_com_capacitor_apaga_devagar() {
    // Capacitor de 1000 µF carregado a 9 V alimentando LED + 330 Ω: a corrente cai com o tempo.
    let c = circuit(
        3,
        vec![
            Element::Capacitor {
                id: "c".into(),
                a: 1,
                b: 0,
                c: 1000e-6,
            },
            r("r", 1, 2, 330.0),
            red_led("d", 2, 0),
        ],
    );
    let start = HashMap::from([("c".to_string(), 9.0)]);
    let early = tran(c.clone(), 0.01, 100, start.clone(), vec![]);
    let late = tran(c, 1.0, 1000, start, vec![]);
    let i_early = get(&early.solution, "d").currents[0];
    let i_late = get(&late.solution, "d").currents[0];
    assert!(i_early > 0.015 && i_late < i_early, "{i_early} → {i_late}");
}

// ---------- Lógica digital ----------

fn logic(id: &str, kind: &str, vcc: usize, ins: Vec<usize>, outs: Vec<usize>) -> Element {
    Element::Logic {
        id: id.into(),
        kind: kind.into(),
        vcc,
        gnd: 0,
        ins,
        outs,
        rout: 50.0,
        skew: 0.0,
    }
}

/// Avança e devolve o estado; `steps` por chamada.
fn run(c: &Circuit, state: HashMap<String, f64>, duration: f64, steps: usize) -> TransientResult {
    transient(&TransientRequest {
        circuit: c.clone(),
        state,
        duration,
        steps,
        guess: vec![],
        probes: vec![],
        t0: 0.0,
    })
    .unwrap()
}

#[test]
fn porta_nand_tabela_verdade() {
    // VCC no nó 1; entradas A (2) e B (3) por fontes; saída no 4 com carga de 10 kΩ.
    for (a, b, y) in [
        (0.0, 0.0, 5.0),
        (0.0, 5.0, 5.0),
        (5.0, 0.0, 5.0),
        (5.0, 5.0, 0.0),
    ] {
        let c = circuit(
            5,
            vec![
                src("vcc", 1, 0, 5.0, 0.01),
                src("a", 2, 0, a, 0.01),
                src("b", 3, 0, b, 0.01),
                logic("u", "nand", 1, vec![2, 3], vec![4]),
                r("load", 4, 0, 10_000.0),
            ],
        );
        let dc = solve(&c).unwrap();
        assert!(dc.converged);
        assert!(
            (dc.voltages[4] - y).abs() < 0.1,
            "DC A={a} B={b}: {}",
            dc.voltages[4]
        );
        let tr = run(&c, HashMap::new(), 1e-3, 60);
        assert!(
            (tr.solution.voltages[4] - y).abs() < 0.1,
            "tran A={a} B={b}: {}",
            tr.solution.voltages[4]
        );
    }
}

#[test]
fn latch_sr_de_nands_guarda_o_estado() {
    // Q = NAND(/S, /Q); /Q = NAND(/R, Q). /S e /R por resistores de pull-up, chaveados por fontes.
    let build = |s_v: f64, r_v: f64| {
        Circuit {
            nodes: 6,
            elements: vec![
                src("vcc", 1, 0, 5.0, 0.01),
                src("s", 2, 0, s_v, 0.01),
                src("r", 3, 0, r_v, 0.01),
                // Q no nó 4, /Q no nó 5.
                Element::Logic {
                    id: "a".into(),
                    kind: "nand".into(),
                    vcc: 1,
                    gnd: 0,
                    ins: vec![2, 5],
                    outs: vec![4],
                    rout: 50.0,
                    skew: 0.01,
                },
                Element::Logic {
                    id: "b".into(),
                    kind: "nand".into(),
                    vcc: 1,
                    gnd: 0,
                    ins: vec![3, 4],
                    outs: vec![5],
                    rout: 50.0,
                    skew: -0.01,
                },
            ],
            prefer_ref: vec![],
        }
    };
    // Liga com as duas entradas em repouso (alto): cai num estado válido, Q ≠ /Q.
    let on = run(&build(5.0, 5.0), HashMap::new(), 0.01, 200);
    let (q, nq) = (on.solution.voltages[4], on.solution.voltages[5]);
    assert!(
        (q > 4.5 && nq < 0.5) || (q < 0.5 && nq > 4.5),
        "estado inválido: Q={q} /Q={nq}"
    );
    // Pulso em /S: Q vai a 1.
    let set = run(&build(0.0, 5.0), on.state, 0.01, 100);
    assert!(set.solution.voltages[4] > 4.5);
    // Solta: continua 1 (memória).
    let hold = run(&build(5.0, 5.0), set.state, 0.01, 100);
    assert!(hold.solution.voltages[4] > 4.5 && hold.solution.voltages[5] < 0.5);
    // Pulso em /R: Q vai a 0 e fica.
    let reset = run(&build(5.0, 0.0), hold.state, 0.01, 100);
    let hold2 = run(&build(5.0, 5.0), reset.state, 0.01, 100);
    assert!(hold2.solution.voltages[4] < 0.5);
}

#[test]
fn oscilador_em_anel_oscila() {
    // Três inversores em anel: nós 2 → 3 → 4 → 2.
    let c = circuit(
        5,
        vec![
            src("vcc", 1, 0, 5.0, 0.01),
            logic("a", "not", 1, vec![2], vec![3]),
            logic("b", "not", 1, vec![3], vec![4]),
            logic("c", "not", 1, vec![4], vec![2]),
        ],
    );
    let out = transient(&TransientRequest {
        circuit: c,
        state: HashMap::new(),
        duration: 1e-3,
        steps: 200,
        guess: vec![],
        probes: vec![2],
        t0: 0.0,
    })
    .unwrap();
    let flips = out
        .samples
        .windows(2)
        .filter(|w| (w[0][1] > 2.5) != (w[1][1] > 2.5))
        .count();
    assert!(flips > 10, "só {flips} transições");
    assert!(!out.settled);
}

#[test]
fn flip_flop_d_captura_na_subida_do_clock() {
    // D (2), CLK (3), /CLR e /PRE no VCC (1); Q no 4, /Q no 5.
    let ff = |d: f64, clk: f64| Circuit {
        nodes: 6,
        elements: vec![
            src("vcc", 1, 0, 5.0, 0.01),
            src("d", 2, 0, d, 0.01),
            src("clk", 3, 0, clk, 0.01),
            Element::Logic {
                id: "ff".into(),
                kind: "dff".into(),
                vcc: 1,
                gnd: 0,
                ins: vec![2, 3, 1, 1],
                outs: vec![4, 5],
                rout: 50.0,
                skew: 0.0,
            },
        ],
        prefer_ref: vec![],
    };
    let s0 = run(&ff(5.0, 0.0), HashMap::new(), 1e-3, 20);
    assert!(
        s0.solution.voltages[4] < 0.5,
        "D muda sem clock: nada acontece"
    );
    let s1 = run(&ff(5.0, 5.0), s0.state, 1e-3, 20);
    assert!(
        s1.solution.voltages[4] > 4.5 && s1.solution.voltages[5] < 0.5,
        "subida do clock copia D"
    );
    let s2 = run(&ff(0.0, 5.0), s1.state, 1e-3, 20);
    assert!(
        s2.solution.voltages[4] > 4.5,
        "D muda com clock parado em alto: Q guarda"
    );
    let s3 = run(&ff(0.0, 0.0), s2.state, 1e-3, 20);
    let s4 = run(&ff(0.0, 5.0), s3.state, 1e-3, 20);
    assert!(s4.solution.voltages[4] < 0.5, "nova subida copia o 0");
}

#[test]
fn contador_4017_conta_pulsos() {
    // CLK (2), INH e RST no GND; Q0..Q9 nos nós 3..12, CO no 13.
    let cnt = |clk: f64| Circuit {
        nodes: 14,
        elements: vec![
            src("vdd", 1, 0, 9.0, 0.01),
            src("clk", 2, 0, clk, 0.01),
            Element::Logic {
                id: "u".into(),
                kind: "decade".into(),
                vcc: 1,
                gnd: 0,
                ins: vec![2, 0, 0],
                outs: (3..14).collect(),
                rout: 300.0,
                skew: 0.0,
            },
        ],
        prefer_ref: vec![],
    };
    let mut st = run(&cnt(0.0), HashMap::new(), 1e-3, 10).state;
    for _ in 0..3 {
        st = run(&cnt(9.0), st, 1e-3, 10).state;
        st = run(&cnt(0.0), st, 1e-3, 10).state;
    }
    let out = run(&cnt(0.0), st, 1e-3, 10).solution;
    let high: Vec<usize> = (3..13)
        .filter(|&n| out.voltages[n] > 4.5)
        .map(|n| n - 3)
        .collect();
    assert_eq!(high, vec![3]);
    assert!(out.voltages[13] > 4.5, "CO alto enquanto conta < 5");
}

#[test]
fn timer_555_astavel_na_frequencia_da_formula() {
    // VCC 9 V; R1 = 1 kΩ (VCC→DIS), R2 = 10 kΩ (DIS→TRIG/THRES), C = 10 µF.
    // f = 1,44 / ((R1 + 2·R2)·C) ≈ 6,86 Hz.
    let c = Circuit {
        nodes: 6,
        elements: vec![
            src("vcc", 1, 0, 9.0, 0.01),
            r("r1", 1, 2, 1000.0),
            r("r2", 2, 3, 10_000.0),
            Element::Capacitor {
                id: "c".into(),
                a: 3,
                b: 0,
                c: 10e-6,
            },
            Element::Timer555 {
                id: "u".into(),
                gnd: 0,
                trig: 3,
                out: 4,
                reset: 1,
                ctrl: 5,
                thresh: 3,
                dis: 2,
                vcc: 1,
            },
            r("load", 4, 0, 10_000.0),
        ],
        prefer_ref: vec![],
    };
    let out = transient(&TransientRequest {
        circuit: c,
        state: HashMap::new(),
        duration: 2.0,
        steps: 40_000,
        guess: vec![],
        probes: vec![4, 3],
        t0: 0.0,
    })
    .unwrap();
    // Ignora o primeiro ciclo (o capacitor começa descarregado).
    let rises: Vec<f64> = out
        .samples
        .windows(2)
        .filter(|w| w[0][1] < 4.0 && w[1][1] >= 4.0)
        .map(|w| w[1][0])
        .skip(1)
        .collect();
    let period = (rises[rises.len() - 1] - rises[0]) / (rises.len() - 1) as f64;
    let f = 1.0 / period;
    assert!((f - 6.86).abs() < 0.4, "f = {f}");
    // O capacitor fica entre ⅓ e ⅔ de 9 V.
    let vc: Vec<f64> = out.samples.iter().skip(20_000).map(|s| s[2]).collect();
    let (lo, hi) = vc
        .iter()
        .fold((f64::MAX, f64::MIN), |(a, b), &x| (a.min(x), b.max(x)));
    assert!(
        (lo - 3.0).abs() < 0.2 && (hi - 6.0).abs() < 0.2,
        "{lo}..{hi}"
    );
}

#[test]
fn pnp_e_pmos_como_chave_do_lado_positivo() {
    // PNP: emissor no +9 V, base puxada a 0 por 10 kΩ → conduz para a carga.
    let pnp = circuit(
        4,
        vec![
            src("vcc", 1, 0, 9.0, 0.01),
            r("rb", 2, 0, 10_000.0),
            Element::Pnp {
                id: "q".into(),
                c: 3,
                b: 2,
                e: 1,
                is: 1e-14,
                bf: 200.0,
                br: 4.0,
            },
            r("load", 3, 0, 1000.0),
        ],
    );
    let s = solve(&pnp).unwrap();
    assert!(s.converged && s.voltages[3] > 8.5, "PNP: {}", s.voltages[3]);
    // PMOS: fonte no +9 V, porta em 0 → liga; porta em 9 V → desliga.
    let pmos = |vg: f64| {
        circuit(
            4,
            vec![
                src("vcc", 1, 0, 9.0, 0.01),
                src("g", 2, 0, vg, 0.01),
                Element::Pmos {
                    id: "m".into(),
                    d: 3,
                    g: 2,
                    s: 1,
                    k: 0.5,
                    vth: 2.0,
                },
                r("load", 3, 0, 1000.0),
            ],
        )
    };
    assert!(solve(&pmos(0.0)).unwrap().voltages[3] > 8.5);
    assert!(solve(&pmos(9.0)).unwrap().voltages[3] < 0.1);
}

/// LED azul: ~3,0 V a 20 mA. Is tão pequeno que o ponto de operação passa de XMAX.
fn blue_led(id: &str, a: usize, k: usize) -> Element {
    let n = 2.0;
    let is = 0.02 / ((3.0 - 0.02 * 10.0) / (n * VT)).exp();
    Element::Diode {
        id: id.into(),
        a,
        k,
        is,
        n,
        rs: 10.0,
    }
}

#[test]
fn led_azul_com_resistor() {
    // 9 V → 330 Ω → LED azul → GND: I ≈ (9 − ~3) / 330 ≈ 18 mA.
    let s = solve(&circuit(
        3,
        vec![
            src("bt", 1, 0, 9.0, 1.5),
            r("r", 1, 2, 330.0),
            blue_led("d", 2, 0),
        ],
    ))
    .unwrap();
    assert!(s.converged);
    let i = get(&s, "d").currents[0];
    assert!((0.016..0.020).contains(&i), "corrente {i}");
    let vf = s.voltages[2];
    assert!((2.8..3.2).contains(&vf), "vf {vf}");
}

#[test]
fn led_azul_direto_na_fonte_de_bancada() {
    // 24 V direto no LED, sem resistor: só Rs = 10 Ω segura, I ≈ (24 − ~3,3) / 10 ≈ 2 A.
    let s = solve(&circuit(
        2,
        vec![
            Element::Supply {
                id: "ps".into(),
                p: 1,
                n: 0,
                v: 24.0,
                r: 0.01,
                ilim: 5.0,
            },
            blue_led("d", 1, 0),
        ],
    ))
    .unwrap();
    assert!(s.converged);
    let i = get(&s, "d").currents[0];
    assert!(i > 1.5, "corrente {i}");
}
