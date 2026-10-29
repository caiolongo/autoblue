export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const key = (p: Point) => `${p.x},${p.y}`;

export const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** p está sobre o segmento ab (inclusive as pontas)? */
export function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return (
    p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
  );
}

/** Rotação em passos de 90° no sentido horário (y para baixo), com espelho horizontal antes. */
export function rotatePoint(p: Point, rot: number, flip: boolean): Point {
  let x = flip ? -p.x : p.x;
  let y = p.y;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) [x, y] = [-y, x];
  return { x: x + 0, y: y + 0 };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
