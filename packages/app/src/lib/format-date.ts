/**
 * A date the way a person in this product reads it: `14/12/2026`, day first, in UTC.
 *
 * UTC on purpose. The server stores instants, and a token that expires "on the 14th" must say the 14th to the
 * person in Buenos Aires and to the one in Madrid alike -- formatting in the browser's zone would show a token
 * that expires at 23:59 UTC as the 13th to half the team.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

/**
 * The same date, plus the time: `27/09/2026, 18:21`.
 *
 * `hour12: false` is not decoration. `es-AR` resolves to the h12 cycle in the ICU that ships with current
 * Node and Chrome (verified: the option object without it renders `27/09/2026, 06:21 p. m.`), and this product
 * reads the clock the 24-hour way, so the cycle is pinned instead of inherited from the runtime.
 */
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/** `dd/mm/aaaa, hh:mm`, es-AR and UTC, for the places that need the instant, not just the day. */
export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}
