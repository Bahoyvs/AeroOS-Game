/**
 * Ghost notifications — the copy the Buffer Overflow speaks in (GDD v2 §7.2).
 *
 * These are balloons from apps that are not open, about things that did not
 * happen. The unease is meant to come from the *plausibility*: every one of them
 * is a message the real app could have sent, addressed to somebody who is not
 * quite the player. Nothing here is gore or a jump scare; it is an OS being
 * confidently wrong about who is using it.
 *
 * A table, not a generator. `core/overflow.js` picks a row from a stored seed
 * and derives the rest, so a screenful of ghosts costs two numbers in the save
 * (see `data/buddies.js` for the same pattern).
 */

export const GHOSTS = [
  {
    app: 'chainmail',
    tone: 'warn',
    title: 'New message from yourself',
    body: 'Subject: FW: FW: RE: are you still there. Sent 4 minutes ago.',
  },
  {
    app: 'aerochat',
    tone: 'info',
    title: '17 buddies are typing',
    body: 'None of them are online.',
  },
  {
    app: 'thealgorithm',
    tone: 'info',
    title: 'Engagement recovered',
    body: 'We filled the quiet for you. You do not need to read it.',
  },
  {
    app: 'flashfarm',
    tone: 'warn',
    title: 'Your session is still running',
    body: 'You stopped watching 2 hours ago. It did not stop.',
  },
  {
    app: 'botnet',
    tone: 'error',
    title: 'Host 0.0.0.0 responded',
    body: 'It has your hostname. It has had it for a while.',
  },
  {
    app: 'geopage',
    tone: 'info',
    title: 'Your guestbook has 1,204 new entries',
    body: 'All from the same visitor. All at 03:14.',
  },
  {
    app: 'vidchat',
    tone: 'warn',
    title: 'Partner reconnected',
    body: 'The same partner. The fourteenth time tonight.',
  },
  {
    app: 'mindsync',
    tone: 'info',
    title: 'Frequency locked',
    body: 'You did not tune it. It found you.',
  },
  {
    app: 'thehive',
    tone: 'error',
    title: 'The feed is waiting',
    body: 'It has been waiting the whole time you were away.',
  },
  {
    app: 'system',
    tone: 'warn',
    title: 'AeroOS is optimising your attention',
    body: 'Do not close this window. There is no close button.',
  },
  {
    app: 'lemonwire',
    tone: 'info',
    title: 'Upload complete',
    body: 'You did not queue anything. 4.2 GB sent.',
  },
  {
    app: 'aeroboards',
    tone: 'info',
    title: 'Someone quoted your post',
    body: 'You have not posted since the last format.',
  },
];
