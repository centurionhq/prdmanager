/**
 * WO-579 (SDD-056/PRD-036 R2): the pieces every Ajustes screen builds its form from -- a section header, a
 * text field, a read-only field, a panel -- as design-system components instead of markup each screen
 * resolves for itself. Behaviour is asserted by role and accessible name, never by class.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Notice, Panel, ReadOnlyField, SectionHeader, SelectField, TextField } from '../../src/components/index.js';

describe('SectionHeader', () => {
  it('is a level-two heading with its subtitle, so the page keeps its single h1', () => {
    render(<SectionHeader title="Tokens de CI" subtitle="Solo un token avanza el reporte oficial." />);

    expect(screen.getByRole('heading', { level: 2, name: 'Tokens de CI' })).toBeTruthy();
    expect(screen.getByText('Solo un token avanza el reporte oficial.')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('carries the primary action of the section next to its title', () => {
    render(<SectionHeader title="Miembros" actions={<button type="button">Invitar persona</button>} />);

    expect(screen.getByRole('button', { name: 'Invitar persona' })).toBeTruthy();
  });

  it('works without a subtitle or actions', () => {
    render(<SectionHeader title="General" />);

    expect(screen.getByRole('heading', { name: 'General' })).toBeTruthy();
  });
});

function Controlled(props: Partial<Parameters<typeof TextField>[0]>): ReactElement {
  const [value, setValue] = useState('main');
  return <TextField label="Rama por defecto" value={value} onChange={setValue} {...props} />;
}

describe('TextField', () => {
  it('is a text input named by its label', () => {
    render(<Controlled />);

    expect(screen.getByLabelText('Rama por defecto')).toHaveProperty('value', 'main');
  });

  it('reports what is typed as a plain string', async () => {
    const onChange = vi.fn();
    render(<TextField label="Nombre" value="" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Nombre'), 'ab');

    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ties its hint to the input, so a screen reader reads it with the field', () => {
    render(<Controlled hint="La baseline oficial se calcula sobre esta rama." />);

    const input = screen.getByLabelText('Rama por defecto');
    const hint = screen.getByText('La baseline oficial se calcula sobre esta rama.');
    expect(input.getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('shows an error as an alert and marks the field invalid, not by colour alone', () => {
    render(<Controlled error="Escribí una rama." />);

    expect(screen.getByRole('alert').textContent).toBe('Escribí una rama.');
    expect(screen.getByLabelText('Rama por defecto').getAttribute('aria-invalid')).toBe('true');
  });

  it('with no error the field is not marked invalid and draws no alert', () => {
    render(<Controlled />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Rama por defecto').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('can be disabled, and can carry a placeholder', () => {
    render(<Controlled disabled placeholder="tu-handle" />);

    const input = screen.getByLabelText('Rama por defecto') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('tu-handle');
  });

  it('two fields on one screen never share an id', () => {
    render(
      <>
        <TextField label="Uno" value="" onChange={() => {}} />
        <TextField label="Dos" value="" onChange={() => {}} />
      </>,
    );

    expect(screen.getByLabelText('Uno').id).not.toBe(screen.getByLabelText('Dos').id);
  });
});

describe('ReadOnlyField', () => {
  it('shows a value that cannot be edited under its label, as text a person can select', () => {
    render(<ReadOnlyField label="Email" value="ana@example.test" note="No se puede cambiar" />);

    expect(screen.getByText('ana@example.test')).toBeTruthy();
    expect(screen.getByText('No se puede cambiar')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
  });

  it('is named by its label for assistive technology, though it is not an input', () => {
    render(<ReadOnlyField label="Organización" value="Centurion HQ" />);

    expect(screen.getByRole('group', { name: 'Organización' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('draws an identifier in the mono face only when it is one', () => {
    render(<ReadOnlyField label="Identificador" value="prdmanager" mono hint="Es el que usás en los comandos." />);

    expect(screen.getByText('prdmanager').className).toMatch(/id/);
    expect(screen.getByText('Es el que usás en los comandos.')).toBeTruthy();
  });
});

describe('Panel', () => {
  it('holds whatever a screen puts in it', () => {
    render(
      <Panel>
        <p>contenido</p>
      </Panel>,
    );

    expect(screen.getByText('contenido')).toBeTruthy();
  });
});

describe('SelectField', () => {
  const OPTIONS = [
    { value: 'acme', label: 'Acme' },
    { value: 'globex', label: 'Globex' },
  ];

  it('is a select named by its label, with the current value selected', () => {
    render(<SelectField label="Organización" value="globex" options={OPTIONS} onChange={() => {}} />);

    expect((screen.getByLabelText('Organización') as HTMLSelectElement).value).toBe('globex');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Acme', 'Globex']);
  });

  it('reports the chosen value', async () => {
    const onChange = vi.fn();
    render(<SelectField label="Organización" value="acme" options={OPTIONS} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText('Organización'), 'globex');

    expect(onChange).toHaveBeenCalledWith('globex');
  });

  it('can keep its label for assistive technology and hide it, when a table header already says it', () => {
    render(<SelectField label="Rol de Ana" value="acme" options={OPTIONS} onChange={() => {}} hideLabel />);

    expect(screen.getByLabelText('Rol de Ana')).toBeTruthy();
  });

  it('ties its hint to the select', () => {
    render(<SelectField label="Rol" value="acme" options={OPTIONS} onChange={() => {}} hint="Quién puede publicar." />);

    expect(screen.getByLabelText('Rol').getAttribute('aria-describedby')).toContain(screen.getByText('Quién puede publicar.').id);
  });
});

describe('Notice', () => {
  it('says something the screen owes the person, without pretending to be an error', () => {
    render(<Notice>No tenés permiso para gestionar tokens de CI.</Notice>);

    expect(screen.getByText('No tenés permiso para gestionar tokens de CI.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
