import { getApp } from '../data/apps.js';
import * as aeroboards from './aeroboards.js';
import * as aerochat from './aerochat.js';
import * as chainmail from './chainmail.js';
import * as geopage from './geopage.js';
import * as aerosweeper from './aerosweeper.js';
import * as lemonwire from './lemonwire.js';
import * as placeholder from './placeholder.js';
import * as retroamp from './retroamp.js';
import * as system from './system.js';

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
  chainmail,
  aeroboards,
  lemonwire,
  geopage,
  aerosweeper,
};

export function mountApp(id, body, ctx) {
  const app = getApp(id);
  const impl = IMPLEMENTATIONS[id] ?? placeholder;
  return impl.mount(body, { ...ctx, app });
}

export function isImplemented(id) {
  return id in IMPLEMENTATIONS;
}
