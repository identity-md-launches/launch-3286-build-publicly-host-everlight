/**
 * When the garden canvas redraws on its own, and how often.
 * - Water ripples animate whenever a stream is on screen and motion is allowed, with or without candles and at
 *   any zoom the water is drawn at (renderer.drawWater draws from zoom 0.3).
 * - Flames flicker only when candles exist and the camera is close enough to see them (zoom >= 0.7).
 * - Hidden tabs and reduced motion never animate; an ignition burst (a just-confirmed purchase) is always shown.
 * Frame rate is capped: 30 fps with flames, 20 fps for water alone. Dirty frames (pan, zoom, data) draw at once.
 */
export interface MotionInput {
  reducedMotion: boolean;
  hidden: boolean;
  zoom: number;
  candles: number;
  waterInView: boolean;
  igniting: boolean;
  /** Ambient frogs are in view (and drawn at this zoom). */
  actors?: boolean;
}
export const ACTOR_FPS = 12;
export const FLAME_ZOOM = 0.7;
export const WATER_ZOOM = 0.3;
export const FLAME_FPS = 30;
export const WATER_FPS = 20;

export function motionPlan(m: MotionInput): { animate: boolean; minGap: number } {
  if (m.hidden) return { animate: false, minGap: Infinity };
  if (m.igniting) return { animate: true, minGap: 0 };
  if (m.reducedMotion) return { animate: false, minGap: Infinity };
  if (m.candles > 0 && m.zoom >= FLAME_ZOOM) return { animate: true, minGap: 1000 / FLAME_FPS };
  if (m.waterInView && m.zoom >= WATER_ZOOM) return { animate: true, minGap: 1000 / WATER_FPS };
  if (m.actors) return { animate: true, minGap: 1000 / ACTOR_FPS };
  return { animate: false, minGap: Infinity };
}

/** Should a frame at time t be drawn? Dirty frames always draw; animated frames respect the cap. */
export function shouldDraw(plan: { animate: boolean; minGap: number }, dirty: boolean, t: number, lastDraw: number): boolean {
  if (dirty) return true;
  if (!plan.animate) return false;
  return t - lastDraw >= plan.minGap - 2; // 2 ms slack so a 60 Hz display lands on every 2nd/3rd vsync
}
