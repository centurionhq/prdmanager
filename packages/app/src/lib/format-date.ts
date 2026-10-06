/**
 * A date the way a person in this product reads it: `14/12/2026`, day first, in UTC.
 *
 * UTC on purpose. The server stores instants, and a token that expires "on the 14th" must say the 14th to the
 * person in Buenos Aires and to the one in Madrid alike -- formatting in the browser's zone would show a token
 * that expires at 23:59 UTC as the 13th to half the team.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}
