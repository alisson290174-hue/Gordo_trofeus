export type Direction = "up" | "down" | "left" | "right";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const center = (box: Box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

/**
 * The closest box in a direction from `from`, the way a TV remote moves: only boxes that are
 * really on that side count, and moving straight is preferred over drifting sideways.
 * Returns the index in `candidates`, or -1.
 */
export const pickNeighbor = (from: Box, candidates: Box[], direction: Direction): number => {
  const origin = center(from);
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  candidates.forEach((box, index) => {
    const target = center(box);
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    let along: number;
    let across: number;
    switch (direction) {
      case "right":
        if (box.left < from.left + from.width - 1 && dx <= 1) return;
        along = dx;
        across = Math.abs(dy);
        break;
      case "left":
        if (box.left + box.width > from.left + 1 && dx >= -1) return;
        along = -dx;
        across = Math.abs(dy);
        break;
      case "down":
        if (box.top < from.top + from.height - 1 && dy <= 1) return;
        along = dy;
        across = Math.abs(dx);
        break;
      default:
        if (box.top + box.height > from.top + 1 && dy >= -1) return;
        along = -dy;
        across = Math.abs(dx);
    }
    if (along <= 0) return;
    // Sideways distance weighs more: a row/column neighbour beats a closer diagonal one.
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
};
