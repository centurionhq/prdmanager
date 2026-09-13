import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import { ingestArtifactFile } from '../../artifacts/ingest.js';
import { ARTIFACT_SOURCES, type ArtifactSource } from '../../domain/schema.js';
import { withContext, type CliDeps } from '../program.js';

function parseSource(value: string): ArtifactSource {
  if (!(ARTIFACT_SOURCES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`source must be one of ${ARTIFACT_SOURCES.join(', ')}`);
  }
  return value as ArtifactSource;
}

function collectLink(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface IngestOptions {
  source: ArtifactSource;
  title?: string;
  link: string[];
  json?: boolean;
}

async function runIngestArtifact(deps: CliDeps, file: string, options: IngestOptions): Promise<void> {
  await withContext(deps, async (ctx) => {
    const result = await ingestArtifactFile(ctx.engine, {
      filePath: file,
      source: options.source,
      title: options.title,
      links: options.link.length > 0 ? options.link : undefined,
    });
    if (options.json) {
      deps.stdout(JSON.stringify(result, null, 2));
      return;
    }
    deps.stdout(`${result.id}: linked to ${result.linkedTo.join(', ') || '(none)'}`);
  });
}

export function register(program: Command, deps: CliDeps): void {
  const ingest = program.command('ingest').description('ingest external artifacts (meeting notes, emails, transcripts)');

  ingest
    .command('artifact')
    .description('ingest a local file as an artifact, auto-linking it to features')
    .argument('<file>', 'path to the artifact file (.txt, .md, .eml, .vtt, .srt, .json)')
    .requiredOption('--source <source>', `artifact source: ${ARTIFACT_SOURCES.join(', ')}`, parseSource)
    .option('--title <title>', 'override the generated title')
    .option('--link <id>', 'link to a feature id (repeatable)', collectLink, [] as string[])
    .option('--json', 'print the result as JSON')
    .action((file: string, options: IngestOptions) => runIngestArtifact(deps, file, options));
}
