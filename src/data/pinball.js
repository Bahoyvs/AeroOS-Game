/**
 * Galactic Pinball 3D — the table itself (Day 7).
 *
 * Geometry only: this file says where the walls, bumpers and flippers *are*,
 * and src/core/pinball.js says what happens when a ball touches them. Units are
 * table units, not pixels — the renderer scales the whole thing to whatever the
 * window happens to be, so a table designed here looks the same on a 380px
 * desktop window and a full-screen phone.
 *
 * The coordinate system is the screen's: x grows right, y grows *down*, and
 * gravity is therefore positive. Angles are degrees, measured the same way, and
 * converted once when the table is built.
 */

export const TABLE = {
  width: 100,
  height: 150,

  ballRadius: 2.2,
  /** Below this the ball is gone. A little past the flippers, not level with them. */
  drainY: 154,

  gravity: 120,
  /** A ball faster than this tunnels through walls between substeps. */
  maxSpeed: 240,
  wallRestitution: 0.52,

  /**
   * The plunger lane, bottom right. Powers are table units per second, and the
   * *minimum* is set so that even a tapped plunger clears the lane: the lane
   * has no floor, so a ball that fails to crest it falls straight back down and
   * drains, which spends a token on nothing. Within that range the charge
   * decides how hard the ball comes off the top rail, and therefore where in
   * the bumpers it lands — the skill shot, not a coin toss.
   */
  launch: { x: 91, y: 138, minPower: 170, maxPower: 205, chargeSeconds: 0.85 },

  /**
   * The cabinet, as line segments. The order is the tour: top rail, the slant
   * that turns a launched ball back into the playfield, the right rail, the
   * lane divider, the left rail, and the two inlane walls that funnel whatever
   * survives down onto the flippers.
   */
  walls: [
    { a: [4, 10], b: [76, 10] },
    { a: [76, 10], b: [96, 30] },
    { a: [96, 30], b: [96, 142] },
    { a: [86, 32], b: [86, 142] },
    { a: [4, 10], b: [4, 100] },
    // The funnel. Bouncier than the rails: this is the wall that saves a ball,
    // and a dead one just posts it straight down the outlane.
    { a: [4, 100], b: [24, 122], bounce: 0.72 },
    { a: [86, 100], b: [76, 122], bounce: 0.72 },
  ],

  /**
   * The scoring targets. `kick` is the impulse a bumper adds on top of the
   * bounce — it is what makes a ball speed *up* in the middle of the table
   * instead of bleeding energy until it drains. `points` is the combo it pays.
   */
  bumpers: [
    { x: 30, y: 44, r: 7, kick: 46, points: 1 },
    { x: 50, y: 30, r: 7, kick: 46, points: 1 },
    { x: 70, y: 44, r: 7, kick: 46, points: 1 },
    { x: 40, y: 66, r: 5, kick: 38, points: 1 },
    { x: 60, y: 66, r: 5, kick: 38, points: 1 },
    // Posts: they change the angle, they do not pay. Without something that
    // only deflects, every bounce is a reward and the table has no texture.
    { x: 16, y: 78, r: 3, kick: 12, points: 0 },
    { x: 74, y: 78, r: 3, kick: 12, points: 0 },
  ],

  /**
   * Two flippers, mirrored. `rest` is where gravity leaves them and `active` is
   * where the player's finger puts them; the sweep between the two is where all
   * the skill in the game lives.
   *
   * The pivots and the length are set together so that the gap between the two
   * resting tips (~13 units) is comfortably wider than a ball plus both
   * flippers' thickness (~8.4). Closer together and the tips catch every ball
   * that comes down the middle — the table stops being able to end.
   */
  flippers: [
    { side: 'left', x: 26, y: 126, length: 19, thickness: 2, rest: 26, active: -24 },
    { side: 'right', x: 74, y: 126, length: 19, thickness: 2, rest: 154, active: 204 },
  ],

  /** How fast a flipper swings, in radians per second. */
  flipperSpeed: 16,
};
