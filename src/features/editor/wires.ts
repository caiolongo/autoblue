import { key, onSegment, samePoint, type Point, type Rect } from "../../lib/geometry";

/**
 * Caminho em L de a até b. Segue primeiro na direção de maior distância, a não ser
 * que esse caminho passe por cima de algum ponto de `avoid` (pinos): aí tenta o outro L,
 * para não ligar nada sem querer.
 */
export function orthoPath(a: Point, b: Point, avoid: Point[] = []): Point[] {
  if (a.x === b.x || a.y === b.y) return [a, b];
  const h = [a, { x: b.x, y: a.y }, b];
  const v = [a, { x: a.x, y: b.y }, b];
  const options = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? [h, v] : [v, h];
  const clear = (path: Point[]) =>
    !avoid.some(
      (p) => !samePoint(p, a) && !samePoint(p, b) && (onSegment(p, path[0], path[1]) || onSegment(p, path[1], path[2])),
    );
  return options.find(clear) ?? options[0];
}

/** Quantas células além dos pontos o roteador pode explorar. */
const ROUTE_MARGIN = 12;
/** Custo extra por dobra e por célula dentro do corpo de uma peça. */
const BEND_COST = 3;
const BODY_COST = 4;

/**
 * Roteador de fio: busca A* na grade, preferindo poucas dobras e evitando atravessar
 * `bodies` (corpos de peças). Para não ligar nada sem querer, ele nunca passa por
 * `blocked` (pinos e pontas de fio), nem pelas dobras de `wires`, nem corre por cima de
 * um fio existente na mesma direção. Cruzar um fio na perpendicular pode (não liga).
 * Se não achar caminho, volta ao L.
 */
export function route(
  a: Point,
  b: Point,
  grid: number,
  blocked: Point[],
  bodies: Rect[] = [],
  wires: Point[][] = [],
): Point[] {
  if (samePoint(a, b)) return [a];
  // Fios que já tocam a origem ou o destino são do mesmo nó: correr junto deles não liga nada novo.
  const touches = (w: Point[]) => w.some((_, i) => i > 0 && [a, b].some((p) => onSegment(p, w[i - 1], w[i])));
  const others = wires.filter((w) => !touches(w));
  // Se nem assim houver caminho, tenta ignorando os fios (pinos continuam proibidos).
  return search(a, b, grid, blocked, bodies, others) ?? search(a, b, grid, blocked, bodies, []) ?? orthoPath(a, b, blocked);
}

function search(a: Point, b: Point, grid: number, blocked: Point[], bodies: Rect[], wires: Point[][]): Point[] | null {
  const cell = (p: Point) => ({ x: Math.round(p.x / grid), y: Math.round(p.y / grid) });
  const A = cell(a);
  const B = cell(b);
  const minX = Math.min(A.x, B.x) - ROUTE_MARGIN;
  const maxX = Math.max(A.x, B.x) + ROUTE_MARGIN;
  const minY = Math.min(A.y, B.y) - ROUTE_MARGIN;
  const maxY = Math.max(A.y, B.y) + ROUTE_MARGIN;
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;
  const idx = (x: number, y: number) => (y - minY) * W + (x - minX);

  const wall = new Uint8Array(W * H);
  for (const p of blocked) {
    const c = cell(p);
    if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
    if ((c.x === A.x && c.y === A.y) || (c.x === B.x && c.y === B.y)) continue;
    wall[idx(c.x, c.y)] = 1;
  }
  // Fios existentes: dobras viram parede; o resto marca a direção ocupada (1 = horizontal, 2 = vertical).
  const along = new Uint8Array(W * H);
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const isEnd = (x: number, y: number) => (x === A.x && y === A.y) || (x === B.x && y === B.y);
  for (const w of wires) {
    for (let i = 0; i < w.length; i++) {
      const c = cell(w[i]);
      if (i > 0 && i < w.length - 1 && inside(c.x, c.y) && !isEnd(c.x, c.y)) wall[idx(c.x, c.y)] = 1;
      if (i === 0) continue;
      const p = cell(w[i - 1]);
      const horizontal = p.y === c.y;
      const n = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
      for (let k = 0; k <= n; k++) {
        const x = p.x + Math.sign(c.x - p.x) * k;
        const y = p.y + Math.sign(c.y - p.y) * k;
        if (inside(x, y)) along[idx(x, y)] |= horizontal ? 1 : 2;
      }
    }
  }
  const extra = new Uint8Array(W * H);
  for (const r of bodies) {
    for (let y = Math.ceil(r.y / grid); y <= Math.floor((r.y + r.h) / grid); y++)
      for (let x = Math.ceil(r.x / grid); x <= Math.floor((r.x + r.w) / grid); x++)
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) extra[idx(x, y)] = BODY_COST;
  }

  // Estado = célula × direção de chegada (0–3; 4 = início).
  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];
  const N = W * H * 5;
  const cost = new Float64Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const h = (x: number, y: number) => Math.abs(x - B.x) + Math.abs(y - B.y);
  // Fila de prioridade simples (heap binário).
  const heap: [number, number][] = [];
  const pushQ = (f: number, s: number) => {
    heap.push([f, s]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const popQ = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const start = idx(A.x, A.y) * 5 + 4;
  cost[start] = 0;
  pushQ(h(A.x, A.y), start);
  let goal = -1;
  while (heap.length) {
    const [, s] = popQ();
    const c = Math.floor(s / 5);
    const dir = s % 5;
    const x = (c % W) + minX;
    const y = Math.floor(c / W) + minY;
    if (x === B.x && y === B.y) {
      goal = s;
      break;
    }
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const nc = idx(nx, ny);
      if (wall[nc]) continue;
      // Andar na mesma direção de um fio existente seria correr por cima dele.
      if (along[nc] & (d < 2 ? 1 : 2) && along[c] & (d < 2 ? 1 : 2)) continue;
      const ns = nc * 5 + d;
      const g = cost[s] + 1 + extra[nc] + (dir !== 4 && dir !== d ? BEND_COST : 0);
      if (g < cost[ns]) {
        cost[ns] = g;
        from[ns] = s;
        pushQ(g + h(nx, ny), ns);
      }
    }
  }
  if (goal < 0) return null;

  const path: Point[] = [];
  for (let s = goal; s >= 0; s = from[s]) {
    const c = Math.floor(s / 5);
    path.push({ x: ((c % W) + minX) * grid, y: (Math.floor(c / W) + minY) * grid });
  }
  path.reverse();
  path[0] = a;
  path[path.length - 1] = b;
  return simplify(path);
}

/** Remove pontos repetidos e pontos no meio de trechos retos. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length && samePoint(out[out.length - 1], p)) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross === 0) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Leva a ponta inicial de `pts` até `to`, ajustando o vizinho para manter os ângulos retos. */
function moveStart(pts: Point[], to: Point): Point[] {
  const [a, n, ...rest] = pts;
  if (!n) return [to];
  const horizontal = a.y === n.y;
  if (rest.length === 0) {
    // Só dois pontos: a outra ponta fica parada, então entra uma dobra.
    const corner = horizontal ? { x: n.x, y: to.y } : { x: to.x, y: n.y };
    return [to, corner, n];
  }
  const n2 = horizontal ? { x: n.x, y: to.y } : { x: to.x, y: n.y };
  return [to, n2, ...rest];
}

/**
 * Quando pinos (ou pontas de fio) se movem, as pontas de fio presas a eles vão junto.
 * `moved` mapeia a posição antiga (key) para a nova. Retorna null se nada mudou.
 */
export function followEndpoints(points: Point[], moved: Map<string, Point>): Point[] | null {
  const first = moved.get(key(points[0]));
  const last = moved.get(key(points[points.length - 1]));
  if (!first && !last) return null;
  let pts = points;
  if (first) pts = moveStart(pts, first);
  if (last) pts = moveStart([...pts].reverse(), last).reverse();
  return simplify(pts);
}
