import { describe, expect, it } from "vitest";
import { onSegment } from "../../lib/geometry";
import { deserialize, serialize } from "../project/file";
import { addPart, addWire, deleteIds, emptyDoc, moveSelection, pinsOf, transformParts, type Doc } from "./doc";
import { buildNetlist, pinKey } from "./netlist";
import { followEndpoints, orthoPath, route, simplify } from "./wires";

const P = (x: number, y: number) => ({ x, y });

describe("wires", () => {
  it("orthoPath faz um L, primeiro na direção mais longa", () => {
    expect(orthoPath(P(0, 0), P(100, 20))).toEqual([P(0, 0), P(100, 0), P(100, 20)]);
    expect(orthoPath(P(0, 0), P(20, 100))).toEqual([P(0, 0), P(0, 100), P(20, 100)]);
    expect(orthoPath(P(0, 0), P(0, 40))).toEqual([P(0, 0), P(0, 40)]);
  });

  it("orthoPath troca de L para não passar por cima de um pino", () => {
    // O L horizontal passaria pelo pino em (40, 0); o vertical está livre.
    expect(orthoPath(P(0, 0), P(100, 20), [P(40, 0)])).toEqual([P(0, 0), P(0, 20), P(100, 20)]);
    // Pino no destino não conta como obstáculo.
    expect(orthoPath(P(0, 0), P(100, 20), [P(100, 20)])).toEqual([P(0, 0), P(100, 0), P(100, 20)]);
  });

  it("route contorna uma fileira de pinos em vez de passar por cima", () => {
    // De (0,0) a (80,80) com uma parede de pinos em y = 40, de x = -40 a 120, com uma brecha em x = 160.
    const wall = [-40, -20, 0, 20, 40, 60, 80, 100, 120].map((x) => P(x, 40));
    const path = route(P(0, 0), P(80, 80), 20, wall);
    for (let i = 1; i < path.length; i++)
      for (const w of wall) expect(onSegment(w, path[i - 1], path[i])).toBe(false);
    expect(path[0]).toEqual(P(0, 0));
    expect(path[path.length - 1]).toEqual(P(80, 80));
  });

  it("route não corre por cima de um fio existente nem usa a dobra dele", () => {
    // Fio existente: (0,40) → (200,40) → (200,200). O novo vai de (100,0) a (100,80): cruza na perpendicular.
    const old = [P(0, 40), P(200, 40), P(200, 200)];
    const cross = route(P(100, 0), P(100, 80), 20, [old[0], old[2]], [], [old]);
    expect(cross).toEqual([P(100, 0), P(100, 80)]);
    // De (0,0) a (300,40): o caminho mais curto correria sobre y = 40; precisa ficar fora dele.
    const path = route(P(20, 0), P(300, 60), 20, [old[0], old[2]], [], [old]);
    for (let i = 1; i < path.length; i++) {
      const [p, q] = [path[i - 1], path[i]];
      const overlapsH = p.y === 40 && q.y === 40;
      expect(overlapsH && Math.max(p.x, q.x) > 0 && Math.min(p.x, q.x) < 200).toBe(false);
    }
    expect(path.some((p) => p.x === 200 && p.y === 40)).toBe(false);
  });

  it("route sai de um pino cercado pelos próprios fios sem passar por cima de outros pinos", () => {
    // Pino em (0,0) com dois fios do mesmo nó saindo para a direita e para cima; pino vizinho em (0,20).
    const mine = [
      [P(0, 0), P(100, 0)],
      [P(0, 0), P(0, -40), P(60, -40)],
    ];
    const row = [40, 60, 80, 100, 120, 140, 160].map((x) => P(x, 0));
    const path = route(P(0, 0), P(200, 0), 20, [P(0, 20), ...row], [], mine);
    for (let i = 1; i < path.length; i++) for (const p of row) expect(onSegment(p, path[i - 1], path[i])).toBe(false);
  });

  it("route sem obstáculos faz um L simples", () => {
    expect(route(P(0, 0), P(100, 40), 20, [])).toHaveLength(3);
  });

  it("simplify remove repetidos e pontos colineares", () => {
    expect(simplify([P(0, 0), P(0, 0), P(20, 0), P(40, 0), P(40, 20)])).toEqual([P(0, 0), P(40, 0), P(40, 20)]);
  });

  it("ponta presa a um pino acompanha mantendo ângulos retos", () => {
    const moved = new Map([["0,0", P(0, 20)]]);
    expect(followEndpoints([P(0, 0), P(100, 0)], moved)).toEqual([P(0, 20), P(100, 20), P(100, 0)]);
    expect(followEndpoints([P(0, 0), P(60, 0), P(60, 60)], moved)).toEqual([P(0, 20), P(60, 20), P(60, 60)]);
  });

  it("as duas pontas movendo juntas = fio só transladado", () => {
    const moved = new Map([
      ["0,0", P(20, 20)],
      ["80,0", P(100, 20)],
    ]);
    expect(followEndpoints([P(0, 0), P(80, 0)], moved)).toEqual([P(20, 20), P(100, 20)]);
  });

  it("fio que não toca em nada movido não muda", () => {
    expect(followEndpoints([P(0, 0), P(80, 0)], new Map([["40,40", P(0, 0)]]))).toBeNull();
  });
});

/** Bateria 9V em (0,0): + em (60,-20), − em (60,20). Resistor em (160,-20): pinos em (120,-20) e (200,-20). */
function circuit(): { doc: Doc; bt: string; r: string } {
  let doc = emptyDoc();
  let bt: string, r: string;
  [doc, bt] = addPart(doc, "battery9v", P(0, 0));
  [doc, r] = addPart(doc, "resistor", P(160, -20));
  return { doc, bt, r };
}

describe("doc", () => {
  it("designadores sobem por prefixo", () => {
    let doc = emptyDoc();
    let a: string, b: string, c: string;
    [doc, a] = addPart(doc, "resistor", P(0, 0));
    [doc, b] = addPart(doc, "resistor", P(0, 100));
    [doc, c] = addPart(doc, "led", P(0, 200));
    expect([doc.parts[a].ref, doc.parts[b].ref, doc.parts[c].ref]).toEqual(["R1", "R2", "D1"]);
  });

  it("girar 90° leva o pino (40,0) para (0,40)", () => {
    let { doc, r } = circuit();
    doc = transformParts(doc, [r], (p) => ({ rot: (p.rot + 1) % 4 }));
    const pos = pinsOf(doc.parts[r]).map((x) => x.pos);
    expect(pos).toEqual([P(160, -60), P(160, 20)]);
  });

  it("mover uma peça arrasta a ponta do fio preso a ela", () => {
    let { doc, r } = circuit();
    [doc] = addWire(doc, [P(60, -20), P(120, -20)]);
    doc = moveSelection(doc, [r], 0, 40);
    const wire = Object.values(doc.wires)[0];
    expect(wire.points[0]).toEqual(P(60, -20));
    expect(wire.points[wire.points.length - 1]).toEqual(P(120, 20));
  });

  it("apagar remove peça e fio", () => {
    let { doc, r } = circuit();
    let w: string | null;
    [doc, w] = addWire(doc, [P(60, -20), P(120, -20)]);
    doc = deleteIds(doc, [r, w!]);
    expect(Object.keys(doc.parts)).toHaveLength(1);
    expect(Object.keys(doc.wires)).toHaveLength(0);
  });
});

describe("netlist", () => {
  it("pino e ponta de fio no mesmo ponto ficam no mesmo nó, com o nome da fonte", () => {
    let { doc, bt, r } = circuit();
    [doc] = addWire(doc, [P(60, -20), P(120, -20)]);
    const n = buildNetlist(doc);
    const net = n.byPin.get(pinKey(bt, "+"))!;
    expect(net).toBe(n.byPin.get(pinKey(r, "1")));
    expect(net.name).toBe("9V");
    expect(net.kind).toBe("power");
    expect(n.byPin.get(pinKey(bt, "-"))!.name).toBe("GND");
  });

  it("ponta de fio no meio de outro fio = junção", () => {
    let { doc, bt, r } = circuit();
    [doc] = addWire(doc, [P(60, -20), P(120, -20)]);
    [doc] = addWire(doc, [P(100, -20), P(100, 60)]);
    const n = buildNetlist(doc);
    expect(n.junctions).toContainEqual(P(100, -20));
    expect(n.loose).toContainEqual(P(100, 60));
    expect(n.byPin.get(pinKey(bt, "+"))).toBe(n.byPin.get(pinKey(r, "1")));
  });

  it("fios que só se cruzam não se ligam", () => {
    let doc = emptyDoc();
    [doc] = addWire(doc, [P(0, 0), P(100, 0)]);
    [doc] = addWire(doc, [P(50, -50), P(50, 50)]);
    const n = buildNetlist(doc);
    const ids = Object.keys(doc.wires);
    expect(n.byWire.get(ids[0])).not.toBe(n.byWire.get(ids[1]));
    expect(n.junctions).toHaveLength(0);
  });

  it("detecta curto direto entre + e − da mesma fonte", () => {
    let { doc } = circuit();
    [doc] = addWire(doc, [P(60, -20), P(80, -20), P(80, 20), P(60, 20)]);
    const n = buildNetlist(doc);
    expect(n.shorts.map((s) => s.ref)).toEqual(["BT1"]);
    expect(n.shorts[0].net.kind).toBe("short");
    expect(n.shorts[0].net.name).toBe("CURTO");
  });

  it("ligar nada a nada é permitido", () => {
    let doc = emptyDoc();
    [doc] = addWire(doc, [P(0, 0), P(40, 0)]);
    const n = buildNetlist(doc);
    expect(n.loose).toHaveLength(2);
    expect(n.nets).toHaveLength(1);
  });
});

describe("arquivo .abp", () => {
  it("salvar e abrir devolve o mesmo documento", () => {
    let { doc } = circuit();
    [doc] = addWire(doc, [P(60, -20), P(120, -20)]);
    expect(deserialize(serialize(doc))).toEqual(doc);
  });

  it("ignora peças desconhecidas e completa propriedades que faltam", () => {
    const doc = deserialize(
      JSON.stringify({
        format: "autoblue",
        version: 1,
        parts: [
          { id: "a", kind: "flux-capacitor", x: 0, y: 0 },
          { id: "b", kind: "resistor", ref: "R9", x: 0, y: 0, props: {} },
        ],
        wires: [{ id: "w", points: [P(0, 0)] }],
      }),
    );
    expect(Object.keys(doc.parts)).toEqual(["b"]);
    expect(doc.parts.b.props.resistance).toBe(220);
    expect(doc.wires).toEqual({});
  });

  it("recusa arquivos de outro formato", () => {
    expect(() => deserialize(JSON.stringify({ format: "outro" }))).toThrow();
  });
});
