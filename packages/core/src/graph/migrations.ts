export const MIGRATIONS: readonly string[] = [
  'CREATE CONSTRAINT node_id IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT coderef_key IF NOT EXISTS FOR (c:CodeRef) REQUIRE c.key IS UNIQUE',
  'CREATE CONSTRAINT commit_sha IF NOT EXISTS FOR (c:Commit) REQUIRE c.sha IS UNIQUE',
  'CREATE CONSTRAINT actor_id IF NOT EXISTS FOR (a:Actor) REQUIRE a.id IS UNIQUE',
  'CREATE INDEX node_status IF NOT EXISTS FOR (n:Node) ON (n.status)',
  'CREATE INDEX node_kind IF NOT EXISTS FOR (n:Node) ON (n.kind)',
  'CREATE FULLTEXT INDEX node_text IF NOT EXISTS FOR (n:Node) ON EACH [n.title, n.body, n.tags_text]',
];
