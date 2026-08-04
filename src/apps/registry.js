import { getApp } from '../data/apps.js';
import * as aerochat from './aerochat.js';
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
  // Day 4: lemonwire, shield99
  // Day 5: aerostudio, aeroburn
  // Day 6: pinball
};

export function mountApp(id, body, ctx) {
  const app = getApp(id);
  const impl = IMPLEMENTATIONS[id] ?? placeholder;
  return impl.mount(body, { ...ctx, app });
}

export function isImplemented(id) {
  return id in IMPLEMENTATIONS;
}
