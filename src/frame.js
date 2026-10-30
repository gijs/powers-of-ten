// Shared frame geometry.
//
// The measuring square is the authority on scale, not the camera. s is defined
// as log10 of the width *the square denotes*, so when the HUD says the frame is
// 10^5 m across, the square really does enclose 10^5 metres of content. The
// camera therefore has to see somewhat more than one decade — exactly
// FRAME_UNITS of them — which is also what gives the film its characteristic
// inset frame with live content spilling past it.
//
// Both hud.js and stage.js derive from these; nothing may hardcode them
// separately, because the moment the two drift the squares stop nesting.

export const VIEW_W = 1200;
export const VIEW_H = 900; // 4:3, as the film is
export const CENTRE_X = VIEW_W / 2;
export const CENTRE_Y = VIEW_H / 2;

/** On-screen side of a square at the top of its decade, in view units. */
export const BASE_SIDE = 0.62 * VIEW_H;

/**
 * Width of the camera's view, in decade units. A decade's unit square then
 * covers BASE_SIDE/VIEW_W of the screen — i.e. it lands exactly on the HUD
 * square — and its 1/10 grid cells land exactly on the next square down.
 */
export const FRAME_UNITS = VIEW_W / BASE_SIDE; // ~2.151

/** Vertical field of view, degrees. */
export const FOV = 30;
/** Frame aspect. The film is 4:3, and the HUD square maths assumes it. */
export const ASPECT = 4 / 3;

/**
 * Camera distance, in world units, at which FRAME_UNITS span the frame width —
 * so one decade unit lands exactly on the HUD's measuring square.
 *
 * Bands need this too, not just the camera: one world unit is 10^s metres, so
 * the viewpoint is physically CAMERA_DISTANCE * 10^s metres from the origin,
 * and anything reasoning about distance to the viewer has to agree with it.
 */
export const CAMERA_DISTANCE = FRAME_UNITS / (2 * ASPECT * Math.tan((FOV * Math.PI / 180) / 2));
