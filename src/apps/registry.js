import { getApp } from '../data/apps.js';
import { isBuilding } from '../data/buildings.js';
import { hasMinigame } from '../core/minigames.js';
import { mountBuildingPanel } from '../ui/buildingPanel.js';
import { openMinigame } from '../ui/minigames.js';
import * as aeroburn from './aeroburn.js';
import * as aerochat from './aerochat.js';
import * as aerosweeper from './aerosweeper.js';
import * as lemonwire from './lemonwire.js';
import * as placeholder from './placeholder.js';
import * as retroamp from './retroamp.js';
import * as shield99 from './shield99.js';
import * as system from './system.js';
import * as aerostudio from './aerostudio.js';
import * as vidchat from './vidchat.js';
import * as registrydoctor from './registrydoctor.js';
import * as geopage from './geopage.js';
import * as achievements from './achievements.js';

/**
 * Maps an app id to the module that renders its window body. Anything missing
 * here falls back to the placeholder, so a new app can be declared in
 * src/data/apps.js and wired up later without breaking the desktop.
 *
 * Adding a real app: implement `mount(body, ctx) -> cleanup?` and register it.
 */
const IMPLEMENTATIONS = {
  system,
  aerochat,
  retroamp,
  lemonwire,
  shield99,
  aeroburn,
  aerostudio,
  aerosweeper,
  vidchat,
  registrydoctor,
  geopage,
  achievements,
};

/**
 * Mount an app's window body, and — if that app is also a *building* — its
 * units-and-upgrades panel underneath (v2 §2, §4).
 *
 * The panel is attached here rather than by each app module for one reason:
 * nine Full Window buildings would otherwise carry nine copies of the same
 * mount/cleanup pair, and the ninth would eventually drift from the first. An
 * app that wants to place the panel somewhere specific in its layout leaves a
 * `[data-role="panel"]` element for it; anything else gets it appended, which
 * is the right default because the panel is the densest thing in the window.
 */
export function mountApp(id, body, ctx) {
  const app = getApp(id);
  const impl = IMPLEMENTATIONS[id] ?? placeholder;
  const cleanupApp = impl.mount(body, { ...ctx, app });

  /**
   * An app that draws its own economy UI opts out by exporting
   * `ownsBuildingUI`. That is the migration switch: as each app grows a bespoke
   * interface — contacts in AeroChat, blades in Aero Studio — it sets the flag
   * and stops receiving the shared panel. When all twelve are converted the
   * fallback below and the flag both go.
   */
  if (!isBuilding(id) || impl.ownsBuildingUI === true) return cleanupApp;

  let host = body.querySelector('[data-role="panel"]');
  if (!host) {
    host = document.createElement('section');
    host.className = 'app__building';
    body.appendChild(host);
  } else if (host.childElementCount > 0) {
    // The app mounted its own panel already (the three v2 newcomers do, because
    // their chrome is built around it). Leave it alone.
    return cleanupApp;
  }

  const cleanupPanel = mountBuildingPanel(host, {
    game: ctx.game,
    buildingId: id,
    onPlayMinigame: hasMinigame(id) ? (gameId) => openMinigame(gameId, { game: ctx.game }) : null,
  });

  return () => {
    cleanupPanel();
    cleanupApp?.();
  };
}

export function isImplemented(id) {
  return id in IMPLEMENTATIONS;
}
