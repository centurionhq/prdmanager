/**
 * Left column of the Documento screen (WO-287): título, a read-only estado, the feature this
 * blueprint designs (when it is one), removable "rutas impactadas" and tags, plus the file path
 * and version footer.
 */
import { X } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { IdTag } from '../../components';
import { getBlueprint, getFeature, getPerson, type DocumentVersion, type ProjectDocument, type WorkflowState } from '../../data';
import styles from './FrontmatterForm.module.css';
import { workflowLabel } from './labels';

function joinAuthorNames(contributorIds: readonly string[]): string {
  const names = contributorIds.map((id) => getPerson(id)?.name ?? id);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

export interface FrontmatterFormProps {
  readonly document: ProjectDocument;
  readonly workflowState: WorkflowState;
  readonly architectOf: string | undefined;
  readonly latestVersion: DocumentVersion | undefined;
}

function ChipList({
  label,
  chips,
  onRemove,
  onAdd,
  addLabel,
  mono,
}: {
  readonly label: string;
  readonly chips: readonly string[];
  readonly onRemove: (value: string) => void;
  readonly onAdd: (value: string) => void;
  readonly addLabel: string;
  readonly mono?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState('');
  const inputId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft('');
  }

  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.chipRow}>
        {chips.map((chip) => (
          <span key={chip} className={styles.chip}>
            <span className={[styles.chipText, mono ? 'id' : null].filter(Boolean).join(' ')} title={chip}>
              {chip}
            </span>
            <button type="button" aria-label={`Quitar ${chip}`} className={styles.chipRemove} onClick={() => onRemove(chip)}>
              <X aria-hidden="true" size={12} />
            </button>
          </span>
        ))}
        <form className={styles.chipForm} onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor={inputId}>
            {addLabel}
          </label>
          <input id={inputId} className={styles.chipInput} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={addLabel} />
        </form>
      </div>
    </div>
  );
}

export function FrontmatterForm({ document, workflowState, architectOf, latestVersion }: FrontmatterFormProps): ReactElement {
  const [title, setTitle] = useState(document.title);
  const [tags, setTags] = useState<readonly string[]>(document.tags);
  const [paths, setPaths] = useState<readonly string[]>(() => getBlueprint(document.id)?.impactsPaths ?? []);
  const architectFeature = architectOf ? getFeature(architectOf) : undefined;
  const titleId = useId();
  const stateId = useId();

  return (
    <div className={styles.form}>
      <h2 className={styles.heading}>Frontmatter</h2>

      <label className={styles.field} htmlFor={titleId}>
        <span className={styles.label}>Título</span>
        <input id={titleId} className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <label className={styles.field} htmlFor={stateId}>
        <span className={styles.label}>Estado</span>
        <select id={stateId} className={styles.input} value={workflowState} disabled>
          <option value={workflowState}>{workflowLabel(workflowState)}</option>
        </select>
      </label>

      {architectFeature ? (
        <div className={styles.field}>
          <span className={styles.label}>Arquitecta de</span>
          <div className={styles.readOnlyRow}>
            <IdTag id={architectFeature.id} />
            <span className={styles.readOnlyText}>{architectFeature.title}</span>
          </div>
        </div>
      ) : null}

      {getBlueprint(document.id) ? (
        <ChipList label="Rutas impactadas" chips={paths} onRemove={(value) => setPaths((current) => current.filter((path) => path !== value))} onAdd={(value) => setPaths((current) => [...current, value])} addLabel="Agregar ruta" mono />
      ) : null}

      <ChipList label="Tags" chips={tags} onRemove={(value) => setTags((current) => current.filter((tag) => tag !== value))} onAdd={(value) => setTags((current) => [...current, value])} addLabel="Agregar tag" />

      <div className={styles.footer}>
        <span>
          Archivo <span className="id">{document.sourcePath}</span>
        </span>
        {latestVersion ? (
          <span>
            Versión {latestVersion.versionNo} · autores {joinAuthorNames(latestVersion.contributors)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
