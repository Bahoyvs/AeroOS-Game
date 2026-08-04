/**
 * Audio routing. The sound design itself is AO-31 (Day 7) — what lives here is
 * the plumbing every future sound goes through: one AudioContext, one master
 * gain, and the two questions a caller asks before playing anything.
 *
 * Mute has two independent sources and the portal always wins:
 *
 * - `state.settings.sfx` / `.bgm` — the player's own toggles, persisted in the
 *   save. These only gate *new* sounds.
 * - The CrazyGames audio setting — the portal mutes the whole game (the player
 *   used the site chrome's mute, or an ad is about to play). That one is applied
 *   straight to the master gain so sounds already in flight stop too, and no
 *   in-game setting can override it.
 *
 * The context is created lazily: browsers start it suspended until a user
 * gesture anyway, and there is nothing to play at boot.
 */
export function createAudio({ game, sdk = globalThis.CrazyGames?.SDK } = {}) {
  let ctx = null;
  let master = null;
  let sdkMuted = false;

  /** The node every source connects to. Null until the first sound asks for it. */
  function context() {
    if (ctx) return ctx;
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) return null;

    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = sdkMuted ? 0 : 1;
    master.connect(ctx.destination);
    return ctx;
  }

  function onSettingsChange(settings) {
    sdkMuted = Boolean(settings?.muteAudio);
    // Immediate, not ramped: when the portal says mute, it means now.
    if (master) master.gain.value = sdkMuted ? 0 : 1;
  }

  // Optional chaining throughout: off-portal there is no SDK, and the shape of
  // an SDK that failed to init is not worth asserting on.
  try {
    sdk?.game?.addSettingsChangeListener?.(onSettingsChange);
    // The portal can already be muted before the first change event fires.
    onSettingsChange(sdk?.game?.settings);
  } catch (err) {
    console.warn('[audio] portal audio settings unavailable', err);
  }

  return {
    context,
    /** The master gain node, or null before the first sound created the context. */
    get master() {
      return master;
    },
    /** True while the portal has muted us, regardless of in-game settings. */
    get portalMuted() {
      return sdkMuted;
    },
    sfxOn: () => !sdkMuted && game.state.settings.sfx,
    bgmOn: () => !sdkMuted && game.state.settings.bgm,
    dispose() {
      try {
        sdk?.game?.removeSettingsChangeListener?.(onSettingsChange);
      } catch {
        /* listener was never registered */
      }
    },
  };
}
