export interface Point { x: number; y: number }
export interface NodeBounds { left: number; right: number; top: number; bottom: number }

/** Round orthogonal corners without the overshoot of a backward Bezier edge. */
export const roundedPath = (points: Point[], radius = 8): string => {
  const clean = points.filter((point, index) => index === 0 ||
    point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  if (clean.length < 2) return '';
  let path = `M ${clean[0].x} ${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const previous = clean[i - 1];
    const point = clean[i];
    const next = clean[i + 1];
    const before = Math.hypot(point.x - previous.x, point.y - previous.y);
    const after = Math.hypot(next.x - point.x, next.y - point.y);
    const bend = Math.min(radius, before / 2, after / 2);
    const enter = {
      x: point.x - (point.x - previous.x) * bend / before,
      y: point.y - (point.y - previous.y) * bend / before,
    };
    const leave = {
      x: point.x + (next.x - point.x) * bend / after,
      y: point.y + (next.y - point.y) * bend / after,
    };
    path += ` L ${enter.x} ${enter.y} Q ${point.x} ${point.y} ${leave.x} ${leave.y}`;
  }
  const end = clean[clean.length - 1];
  return `${path} L ${end.x} ${end.y}`;
};

interface RouteOptions {
  source: Point;
  target: Point;
  bounds: NodeBounds[];
  lane: number;
  fromLeft?: boolean;
}

export const routeLoopBack = ({ source, target, bounds, lane, fromLeft }: RouteOptions) => {
  const left = Math.min(source.x, target.x, ...bounds.map((node) => node.left)) - 40 - lane * 24;
  const departY = fromLeft ? source.y : source.y + 24;
  const points = [source, ...(fromLeft ? [] : [{ x: source.x, y: departY }]),
    { x: left, y: departY }, { x: left, y: target.y }, target];
  return { path: roundedPath(points), points, labelX: left, labelY: (departY + target.y) / 2 };
};

export const routeLoopExit = ({ source, target, bounds, lane }: RouteOptions) => {
  const right = Math.max(source.x, target.x, ...bounds.map((node) => node.right)) + 40 + lane * 24;
  const approachY = target.y - 24;
  const points = [source, { x: right, y: source.y }, { x: right, y: approachY },
    { x: target.x, y: approachY }, target];
  return { path: roundedPath(points), points, labelX: source.x + 24, labelY: source.y };
};
