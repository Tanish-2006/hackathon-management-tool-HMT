import neo4j, { Driver, Session } from 'neo4j-driver';

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
}

let driver: Driver | null = null;

export function getNeo4jDriver(config: Neo4jConfig): Driver {
  if (driver) return driver;
  driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password), {
    maxConnectionPoolSize: 20,
    connectionAcquisitionTimeout: 10000,
  });
  return driver;
}

export function getNeo4jSession(config: Neo4jConfig, driverInstance?: Driver): Session {
  const d = driverInstance ?? getNeo4jDriver(config);
  return d.session({ database: config.database ?? 'neo4j' });
}

export async function checkNeo4jHealth(
  config: Neo4jConfig,
  driverInstance?: Driver,
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const d = driverInstance ?? getNeo4jDriver(config);
  const start = Date.now();
  const session = d.session({ database: config.database ?? 'neo4j' });
  let timer: NodeJS.Timeout | undefined;
  try {
    const run = session.run('RETURN 1 AS ok');
    // Bound the health probe to 2s; the driver itself keeps its normal
    // acquisition timeout so regular queries are unaffected.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Neo4j health check timed out after 2000ms')), 2000);
    });
    timeout.catch(() => {});
    await Promise.race([run, timeout]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer) clearTimeout(timer);
    // session.close() must never mask the original health error.
    try {
      await session.close();
    } catch {
      // ignore close errors — health result already determined
    }
  }
}

export async function closeNeo4jDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

/**
 * Graph modeling philosophy:
 * - Postgres is source of truth for entities (User, Hackathon, Team, Project etc.)
 * - Neo4j models RELATIONSHIPS for traversals: PARTICIPATES_IN, MEMBER_OF, MENTORS, SIMILAR_TO, KNOWS, etc.
 * - On entity creation/update, a background job syncs to Neo4j via event (e.g., TeamCreated).
 * - Never duplicate entire relational state into graph; only relationship edges + minimal props for queries.
 *
 * Example nodes: (:User), (:Hackathon), (:Team), (:Project), (:Skill), (:ProblemStatement)
 * Example rels: (User)-[:MEMBER_OF {role}]->(Team), (Team)-[:PARTICIPATES_IN]->(Hackathon), (User)-[:HAS_SKILL]->(Skill)
 */

export const NEO4J_INIT_CYPHER = `
// Constraints & indexes (idempotent)
CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT hackathon_id IF NOT EXISTS FOR (h:Hackathon) REQUIRE h.id IS UNIQUE;
CREATE CONSTRAINT team_id IF NOT EXISTS FOR (t:Team) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE;
CREATE INDEX skill_name IF NOT EXISTS FOR (s:Skill) ON (s.name);
`;
