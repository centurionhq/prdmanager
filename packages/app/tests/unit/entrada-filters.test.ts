import { describe, expect, it } from 'vitest';
import type { InboxItemDto } from '@prdm/contracts';
import {
  ALL_SOURCES,
  DEFAULT_ENTRADA_QUERY,
  buildEntradaList,
  defaultDirection,
  filterInbox,
  formatReceivedDate,
  inboxSources,
  isAutomatic,
  paginate,
  parseEntradaQuery,
  sortInbox,
  toEntradaSearchParams,
  type EntradaQuery,
} from '../../src/routes/entrada/entrada-filters.js';

function item(overrides: Partial<InboxItemDto> & Pick<InboxItemDto, 'id'>): InboxItemDto {
  return {
    kind: 'FB',
    title: `Título de ${overrides.id}`,
    body: 'Cuerpo del feedback',
    status: 'new',
    source: 'slack',
    links: [],
    receivedAt: '2026-01-01T00:00:00.000Z',
    duplicateOf: null,
    ...overrides,
  };
}

function query(overrides: Partial<EntradaQuery> = {}): EntradaQuery {
  return { ...DEFAULT_ENTRADA_QUERY, ...overrides };
}

describe('parseEntradaQuery', () => {
  it('falls back to the defaults on an empty query string', () => {
    expect(parseEntradaQuery(new URLSearchParams())).toEqual(DEFAULT_ENTRADA_QUERY);
  });

  it('reads each valid value', () => {
    const params = new URLSearchParams({ estado: 'triaged', tipo: 'ART', fuente: 'email', q: 'drift', sort: 'title', dir: 'desc', pagina: '3' });
    expect(parseEntradaQuery(params)).toEqual({
      estado: 'triaged',
      tipo: 'ART',
      fuente: 'email',
      q: 'drift',
      sort: 'title',
      dir: 'desc',
      page: 3,
    });
  });

  it('maps an unknown estado, tipo, sort or dir onto its default', () => {
    const params = new URLSearchParams({ estado: 'dismissed', tipo: 'XX', sort: 'body', dir: 'sideways' });
    expect(parseEntradaQuery(params)).toEqual(DEFAULT_ENTRADA_QUERY);
  });

  it('defaults the direction by sort key: receivedAt desc, everything else asc', () => {
    expect(parseEntradaQuery(new URLSearchParams({ sort: 'receivedAt' })).dir).toBe('desc');
    expect(parseEntradaQuery(new URLSearchParams({ sort: 'title' })).dir).toBe('asc');
    expect(defaultDirection('receivedAt')).toBe('desc');
    expect(defaultDirection('id')).toBe('asc');
  });

  it.each(['0', '-2', 'abc', '1.5', ''])('falls back to page 1 for an invalid pagina (%s)', (pagina) => {
    expect(parseEntradaQuery(new URLSearchParams({ pagina })).page).toBe(1);
  });

  it('trims the source and keeps an empty query as empty', () => {
    const parsed = parseEntradaQuery(new URLSearchParams({ fuente: '  slack  ' }));
    expect(parsed.fuente).toBe('slack');
    expect(parsed.q).toBe('');
  });
});

describe('toEntradaSearchParams', () => {
  it('omits every value at its default', () => {
    expect(toEntradaSearchParams(DEFAULT_ENTRADA_QUERY).toString()).toBe('');
  });

  it('writes the non-default filters, sort and page', () => {
    const params = toEntradaSearchParams(query({ estado: 'new', tipo: 'FB', fuente: 'email', q: 'importador', sort: 'title', dir: 'desc', page: 4 }));
    expect(params.get('estado')).toBe('new');
    expect(params.get('tipo')).toBe('FB');
    expect(params.get('fuente')).toBe('email');
    expect(params.get('q')).toBe('importador');
    expect(params.get('sort')).toBe('title');
    expect(params.get('dir')).toBe('desc');
    expect(params.get('pagina')).toBe('4');
  });

  it('does not write dir when it matches the sort key default, nor pagina 1', () => {
    const params = toEntradaSearchParams(query({ sort: 'title', dir: 'asc', page: 1 }));
    expect(params.get('sort')).toBe('title');
    expect(params.has('dir')).toBe(false);
    expect(params.has('pagina')).toBe(false);
  });

  it('trims the query and writes receivedAt with its own descending default left implicit', () => {
    const params = toEntradaSearchParams(query({ q: '  hola  ', sort: 'receivedAt', dir: 'desc' }));
    expect(params.get('q')).toBe('hola');
    expect(params.has('sort')).toBe(false);
    expect(params.has('dir')).toBe(false);
  });

  it('round-trips through parseEntradaQuery', () => {
    const original = query({ estado: 'triaged', tipo: 'ART', fuente: 'meeting', q: 'daily', sort: 'title', dir: 'desc', page: 2 });
    expect(parseEntradaQuery(toEntradaSearchParams(original))).toEqual(original);
  });
});

describe('filterInbox', () => {
  const items = [
    item({ id: 'FB-001', status: 'new', source: 'slack', title: 'Importador lento' }),
    item({ id: 'FB-002', status: 'triaged', source: 'email', kind: 'ART', title: 'Grabación' }),
    item({ id: 'FB-003', status: 'new', source: 'agent:claude', title: 'Reporte automático' }),
  ];

  it('combines estado, tipo, fuente and query with AND', () => {
    expect(filterInbox(items, query({ estado: 'new', tipo: 'FB', fuente: 'slack' })).map((i) => i.id)).toEqual(['FB-001']);
    expect(filterInbox(items, query({ estado: 'new', tipo: 'FB', fuente: 'email' }))).toEqual([]);
  });

  it('matches the query against id, título and cuerpo, accent- and case-insensitively', () => {
    const accented = [item({ id: 'FB-010', title: 'Configuración de Órdenes' })];
    expect(filterInbox(accented, query({ q: 'ordenes' })).map((i) => i.id)).toEqual(['FB-010']);
    expect(filterInbox(accented, query({ q: 'CONFIGURACION' })).map((i) => i.id)).toEqual(['FB-010']);
    expect(filterInbox(items, query({ q: 'FB-003' })).map((i) => i.id)).toEqual(['FB-003']);
  });

  it('requires every whitespace-separated term to match some field', () => {
    const target = [item({ id: 'FB-020', title: 'El importador tarda 9 minutos', body: 'en repos grandes' })];
    expect(filterInbox(target, query({ q: 'importador repos' })).map((i) => i.id)).toEqual(['FB-020']);
    expect(filterInbox(target, query({ q: 'importador ausente' }))).toEqual([]);
  });

  it('keeps every item for an empty query', () => {
    expect(filterInbox(items, query())).toHaveLength(3);
    expect(filterInbox(items, query({ q: '   ' }))).toHaveLength(3);
  });
});

describe('sortInbox', () => {
  const items = [
    item({ id: 'FB-002', title: 'Banana', receivedAt: '2026-01-03T00:00:00.000Z' }),
    item({ id: 'FB-001', title: 'Ávila', receivedAt: '2026-01-05T00:00:00.000Z' }),
    item({ id: 'FB-003', title: 'Cereza', receivedAt: '2026-01-04T00:00:00.000Z' }),
  ];

  it('sorts by receivedAt descending (the default) and ascending', () => {
    expect(sortInbox(items, { key: 'receivedAt', direction: 'desc' }).map((i) => i.id)).toEqual(['FB-001', 'FB-003', 'FB-002']);
    expect(sortInbox(items, { key: 'receivedAt', direction: 'asc' }).map((i) => i.id)).toEqual(['FB-002', 'FB-003', 'FB-001']);
  });

  it('sorts by título and by id', () => {
    expect(sortInbox(items, { key: 'title', direction: 'asc' }).map((i) => i.id)).toEqual(['FB-001', 'FB-002', 'FB-003']);
    expect(sortInbox(items, { key: 'id', direction: 'desc' }).map((i) => i.id)).toEqual(['FB-003', 'FB-002', 'FB-001']);
  });

  it('never mutates the input and keeps ties stable', () => {
    const original = items.map((i) => i.id);
    const tied = [item({ id: 'FB-009' }), item({ id: 'FB-008' })];
    expect(sortInbox(tied, { key: 'receivedAt', direction: 'desc' }).map((i) => i.id)).toEqual(['FB-009', 'FB-008']);
    expect(items.map((i) => i.id)).toEqual(original);
  });
});

describe('paginate', () => {
  const numbers = Array.from({ length: 26 }, (_, index) => index + 1);

  it('returns an empty single page for an empty list', () => {
    expect(paginate([], 1, 25)).toEqual({ items: [], page: 1, pageCount: 1, total: 0 });
    expect(paginate([], 4, 25).page).toBe(1);
  });

  it('slices the requested page and reports the real total', () => {
    const first = paginate(numbers, 1, 25);
    expect(first.items).toHaveLength(25);
    expect(first.total).toBe(26);
    expect(first.pageCount).toBe(2);

    const second = paginate(numbers, 2, 25);
    expect(second.items).toEqual([26]);
  });

  it('clamps a page below 1 or past the end', () => {
    expect(paginate(numbers, 0, 25).page).toBe(1);
    expect(paginate(numbers, -3, 25).page).toBe(1);
    expect(paginate(numbers, 9, 25).page).toBe(2);
    expect(paginate(numbers, 9, 25).items).toEqual([26]);
  });

  it('handles a page size of 1 and exact boundaries', () => {
    expect(paginate([1, 2, 3], 2, 1).items).toEqual([2]);
    expect(paginate([1, 2], 3, 2).pageCount).toBe(1);
    expect(paginate([1, 2], 3, 2).page).toBe(1);
  });
});

describe('buildEntradaList', () => {
  const items = [
    item({ id: 'FB-001', source: 'slack', receivedAt: '2026-01-05T00:00:00.000Z' }),
    item({ id: 'FB-002', source: 'agent:claude', receivedAt: '2026-01-04T00:00:00.000Z' }),
    item({ id: 'FB-003', source: 'email', receivedAt: '2026-01-03T00:00:00.000Z' }),
  ];

  it('splits automáticos out of the paginated human rows', () => {
    const list = buildEntradaList(items, query());
    expect(list.manual.items.map((i) => i.id)).toEqual(['FB-001', 'FB-003']);
    expect(list.manual.total).toBe(2);
    expect(list.automatic.map((i) => i.id)).toEqual(['FB-002']);
  });

  it('applies filtros y búsqueda inside the automatic group too (D6)', () => {
    // The query matches the automatic item by título/id, and then still lands in the automatic bucket.
    const filtered = buildEntradaList(items, query({ q: 'Título de FB-002' }));
    expect(filtered.manual.items).toEqual([]);
    expect(filtered.automatic.map((i) => i.id)).toEqual(['FB-002']);
    expect(buildEntradaList(items, query({ fuente: 'slack' })).automatic).toEqual([]);
  });

  it('paginates only the human rows', () => {
    const many = Array.from({ length: 30 }, (_, index) => item({ id: `FB-1${String(index).padStart(2, '0')}`, source: index === 29 ? 'agent:x' : 'slack' }));
    const list = buildEntradaList(many, query({ page: 2 }), 25);
    expect(list.manual.page).toBe(2);
    expect(list.manual.items).toHaveLength(4);
    expect(list.automatic).toHaveLength(1);
  });

  it('clamps a page past the end of the filtered set', () => {
    const list = buildEntradaList(items, query({ page: 10 }));
    expect(list.manual.page).toBe(1);
    expect(list.manual.items.map((i) => i.id)).toEqual(['FB-001', 'FB-003']);
  });
});

describe('isAutomatic / inboxSources', () => {
  it('flags sources that start with agent:', () => {
    expect(isAutomatic(item({ id: 'FB-001', source: 'agent:claude' }))).toBe(true);
    expect(isAutomatic(item({ id: 'FB-002', source: 'slack' }))).toBe(false);
    expect(isAutomatic(item({ id: 'FB-003', source: 'agentless' }))).toBe(false);
  });

  it('lists the distinct sources, sorted and deduplicated', () => {
    const items = [item({ id: 'FB-1', source: 'slack' }), item({ id: 'FB-2', source: 'email' }), item({ id: 'FB-3', source: 'slack' })];
    expect(inboxSources(items)).toEqual(['email', 'slack']);
    expect(inboxSources([])).toEqual([]);
    expect(ALL_SOURCES).toBe('');
  });
});

describe('formatReceivedDate', () => {
  it('renders DD/MM/YYYY from the ISO date part', () => {
    expect(formatReceivedDate('2026-01-05T00:00:00.000Z')).toBe('05/01/2026');
    expect(formatReceivedDate('2026-12-31T23:59:59.999Z')).toBe('31/12/2026');
  });

  it('passes an unrecognized value through unchanged', () => {
    expect(formatReceivedDate('sin fecha')).toBe('sin fecha');
    expect(formatReceivedDate('')).toBe('');
  });
});
