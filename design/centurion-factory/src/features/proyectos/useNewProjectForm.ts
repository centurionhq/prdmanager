/** Form state for NewProjectModal: name plus an auto-derived, editable slug. */
import { useEffect, useState, type ChangeEvent } from 'react';
import { isValidSlug, slugify } from './lib';
import type { NewProjectInput } from './NewProjectModal';

const SLUG_ERROR = 'Usá minúsculas, números y guiones.';

export interface UseNewProjectFormResult {
  readonly name: string;
  readonly slug: string;
  readonly error: string | undefined;
  readonly handleNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleSlugChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleSubmit: () => void;
}

export function useNewProjectForm(open: boolean, onCreate: (input: NewProjectInput) => void): UseNewProjectFormResult {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName('');
    setSlug('');
    setSlugTouched(false);
    setError(undefined);
  }, [open]);

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function handleSlugChange(event: ChangeEvent<HTMLInputElement>): void {
    setSlugTouched(true);
    setSlug(event.target.value);
  }

  function handleSubmit(): void {
    if (!isValidSlug(slug)) {
      setError(SLUG_ERROR);
      return;
    }
    onCreate({ name: name.trim() || slug, slug });
  }

  return { name, slug, error, handleNameChange, handleSlugChange, handleSubmit };
}
