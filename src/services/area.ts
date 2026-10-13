export type Point = [number, number]

// Include the boundary as well as the interior, and filter any search matches
// outside the drawn polygon rather than inferring an official parent relation.
export function insideArea(point: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!
    const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0])
    if (Math.abs(cross) < 1e-10 && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1])) return true
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

// Query a compact bounding rectangle, then filter against every original AOI ring.
// This keeps hundreds of AOI vertices out of the API URL without simplifying them.
export function areaRectangle(rings: Point[][]): Point[] {
  const points = rings.flat()
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys)
  return [[left, bottom], [right, bottom], [right, top], [left, top]]
}
