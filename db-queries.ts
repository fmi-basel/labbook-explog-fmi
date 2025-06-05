import * as sql from "mssql";
import { Pool as Pg, type PoolConfig as PgPoolConfig, type QueryResult as PgQueryResult } from "pg";

export interface DBConfig {
    dbType: "mssql" | "postgres";
    user: string;
    password: string;
    server: string;
    port?: number;
    database: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
  }

export interface SiteItem {
    siteID: number;
    displayText: string;
}

// Internal utility function handling ConnectionPool and query execution for mssql
async function withMSSqlDatabase<T>(config: DBConfig, callback: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  const pool = new sql.ConnectionPool({
      user: config.user,
      password: config.password,
      server: config.server,
      port: config.port ?? 1433,
      database: config.database,
      options: {
          encrypt: config.encrypt,
          trustServerCertificate: config.trustServerCertificate,
      },
  });

  const poolConnect = pool.connect();

  pool.on("error", (err) => {
      console.error("SQL Pool Error: ", err);
      throw new Error(`SQL Pool Error: ${err instanceof Error ? err.message : String(err)}`);
  });

  try {
      await poolConnect; // Ensure pool connection is established
      const result = await callback(pool); // Execute query logic using the pool
      return result;
  } catch (err) {
      console.error("SQL Error", err);
      throw new Error(`SQL Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
      await pool.close(); // Ensure the connection pool is closed
  }
}

async function withPostgresDatabase<T>(config: DBConfig, callback: (client: Pg) => Promise<T>): Promise<T> {
  // Build a pg.PoolConfig from your DBConfig
  const pgConfig: PgPoolConfig = {
    user: config.user,
    password: config.password,
    host: config.server,
    port: config.port ?? 5432,
    database: config.database,
    ssl: config.encrypt ? { rejectUnauthorized: !config.trustServerCertificate } : false,
  };

  const pool = new Pg(pgConfig);

  pool.on("error", (err) => {
    console.error("SQL Pool Error:", err);
    throw new Error(`SQL Pool Error: ${err instanceof Error ? err.message : String(err)}`);
  });

  try {
    // (We could do `const client = await pool.connect(); client.release();` to test connectivity,
    //  but pg will lazily connect on first query.)
    return await callback(pool);
  } catch (err) {
    console.error("SQL Error:", err);
    throw new Error(`SQL Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await pool.end(); // Ensure the connection pool is closed
  }
}

function mapPostgresNamedParams(rawQuery: string, params: Record<string, any>): { text: string; values: any[] } {
  const values: any[] = [];
  const nameToIndex: Record<string, number> = {};

  const text = rawQuery.replace(
    /@([a-zA-Z_][a-zA-Z0-9_]*)/g,
    (match, p1) => {
      if (!(p1 in params)) {
        throw new Error(`Missing value for parameter "${p1}"`);
      }
      if (!(p1 in nameToIndex)) {
        nameToIndex[p1] = values.length + 1;
        values.push(params[p1]);
      }
      return `$${nameToIndex[p1]}`;
    }
  );

  return { text, values };
}

// ExecuteReader: For returning rows (specific to mssql)
export async function executeMSSqlReader(config: DBConfig, query: string, params: Record<string, any> = {}): Promise<sql.IResult<any>> {
  return withMSSqlDatabase(config, async (pool) => {
    const request = pool.request();
    for (const key in params) {
        request.input(key, params[key]);
    }
    return await request.query(query);
  });
}

// ExecuteReader: For returning rows (specific to postgres)
export async function executePostgresReader(config: DBConfig, query: string, params: Record<string, any> = {}): Promise<PgQueryResult<any>> {
  return withPostgresDatabase(config, async (pool) => {
    const { text, values } = mapPostgresNamedParams(query, params);
    return pool.query(text, values);
  });
}

// ExecuteScalar: For returning a single value
export async function executeScalar<T>(config: DBConfig, query: string, params: Record<string, any> = {}): Promise<T> {
  if (config.dbType == "mssql") {
    const result = await executeMSSqlReader(config, query, params);
    //return result.recordset[0]?.[Object.keys(result.recordset[0])[0]] as T;
    const firstRow = result.recordset[0];
    return firstRow ? (firstRow[Object.keys(firstRow)[0]] as T) : (null as any);
  }
  else {
    const result = await executePostgresReader(config, query, params);
    const firstRow = result.rows[0];
    return firstRow ? (firstRow[Object.keys(firstRow)[0]] as T) : (null as any);
  }
}

// ExecuteNonQuery: For inserts/updates/deletes
export async function executeNonQuery(config: DBConfig, query: string, params: Record<string, any> = {}): Promise<number> {
  if (config.dbType == "mssql") {
    return withMSSqlDatabase(config, async (pool) => {
      const request = pool.request();
      for (const key in params) {
          request.input(key, params[key]);
      }
      const result = await request.query(query);
      return result.rowsAffected[0]; // Returns the number of affected rows
    });
  }
  else {
    return withPostgresDatabase(config, async (pool) => {
      const { text, values } = mapPostgresNamedParams(query, params);
      const result = await pool.query(text, values);
      return result.rowCount || 0; // Returns the number of affected rows
    });
  }
}

export async function queryPIs(config: DBConfig): Promise<string[]> {
  if (config.dbType == "mssql") {
    return withMSSqlDatabase(config, async (pool) => {
      const query = 'select distinct PI from Animals where PI is not NULL and DataDeleted = 0 order by PI asc;';
      const result = await pool.request().query(query);
      console.log('Query Results (PIs):', result.recordset);
      return result.recordset.map((row) => row.PI as string); // Return the query result
    });
  }
  else {
    const query = 'select distinct pi from Animals where PI is not NULL and DataDeleted = false order by PI asc;'; //lower-case return fields
    return withPostgresDatabase(config, async (pool) => {
      const result = await pool.query(query);
      console.log("Query Results (PIs):", result.rows);
      return result.rows.map((row) => row.pi as string);
    });
  }
}

export async function queryAnimals(config: DBConfig, pi: string): Promise<string[]> {
  if (config.dbType == "mssql") {
    const query = 'select AnimalID from Animals where PI is not NULL and PI = @pi and DataDeleted = 0 order by AnimalID asc;';
    return withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
        .input("pi", sql.VarChar, pi)
        .query(query);

      console.log('Query Results (Animals):', result.recordset);
      return result.recordset.map((row) => row.AnimalID as string); // Return the query result
    });
  }
  else {
    const query = 'select animalid from Animals where PI is not NULL and PI = @pi and DataDeleted = false order by AnimalID asc;'; //lower-case return fields
    return withPostgresDatabase(config, async (pool) => {
      const { text, values } = mapPostgresNamedParams(query, { pi });
      const result = await pool.query(text, values);

      console.log("Query Results (Animals):", result.rows);
      return result.rows.map((row) => row.animalid as string);
    });
  }
}

export async function existsAnimal(config: DBConfig, animalID: string): Promise<boolean> {
  if (config.dbType == "mssql") {
    const query = 'select count(*) as Cnt from Animals where AnimalID = @animalID and DataDeleted = 0;';
    return withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
        .input("animalID", sql.VarChar, animalID)
        .query(query);

      const count = result.recordset[0]?.Cnt as number;
      console.log('Exists Result (Animal):', count > 0);

      return count > 0;
    });
  }
  else {
    const query = 'select count(*) as cnt from Animals where AnimalID = @animalID and DataDeleted = false;'; //lower-case return fields
    return withPostgresDatabase(config, async (pool) => {
      const { text, values } = mapPostgresNamedParams(query, { animalID });
      const result = await pool.query(text, values);

      const count = parseInt(result.rows[0]?.cnt ?? "0", 10);
      console.log('Exists Result (Animal):', count > 0);

      return count > 0;
    });
  }
}

export async function querySites(config: DBConfig, animalID: string): Promise<SiteItem[]> {
  if (config.dbType == "mssql") {
    return withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
        .input("animalID", sql.Int, animalID)
        .query(`
          select s.SiteID, (cast(s.SiteID as varchar(10)) + ':' + (case when st.Comment is not NULL then left(st.Comment, 50) else '' end)) as Display from Sites s
          inner join Experiments e on s.SiteID = e.SiteID
          inner join Stacks st on e.ExpID = st.ExpID
          where s.AnimalID = @animalID and e.ExpID = st.StackID and s.DataDeleted = 0
          order by s.SiteID, st.Comment asc;
        `);

        console.log('Query Results (Sites):', result.recordset);

        // Return the query result
        return result.recordset.map((row) => ({
          siteID: row.SiteID as number,
          displayText: row.Display as string,
        }));
    });
  }
  else {
    const query = `
      select s.siteid, (s.siteid::text || ':' || COALESCE(left(st.comment, 50), '')) as display from Sites s
      inner join Experiments e on s.SiteID = e.SiteID
      inner join Stacks st on e.ExpID = st.ExpID
      where s.AnimalID = @animalID and e.ExpID = st.StackID and s.DataDeleted = false
      order by s.SiteID, st.Comment asc;
    `;

    return withPostgresDatabase(config, async (pool) => {
      const { text, values } = mapPostgresNamedParams(query, { animalID });
      const result = await pool.query(text, values);

      console.log('Query Results (Sites):', result.rows);

      return result.rows.map((row) => ({
        siteID: row.siteid as number,
        displayText: row.display as string,
      }));
    });
  }
}

export async function queryMissingSites(config: DBConfig, siteIDs: number[]): Promise<number[]> {
  if (!siteIDs || siteIDs.length === 0) {
    throw new Error("Parameter siteIDs is empty.");
  }

  let existingSiteIDs: number[] = [];
  const siteIDsJoined = siteIDs.join(", ");

  if (config.dbType == "mssql") {
    existingSiteIDs = await withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
        .query(`
          select s.SiteID from Sites s
          where s.SiteID in (${siteIDsJoined})
          order by s.SiteID asc;
        `);

      return result.recordset.map((row) => row.SiteID as number);
    });
  }
  else {
    existingSiteIDs = await withPostgresDatabase(config, async (pool) => {
      const query = `
          select s.siteid from Sites s
          where s.SiteID in (${siteIDsJoined})
          order by s.SiteID asc;
        `;
      const result = await pool.query(query);

      return result.rows.map((row) => row.siteid as number);
    });
  }

  // No matching siteIDs
  if (!existingSiteIDs || existingSiteIDs.length === 0) {
    return siteIDs;
  }

  // Check all provided siteIDs against the result
  const missingSiteIDs: number[] = [];
  siteIDs.forEach(siteID => {
    if (!existingSiteIDs.contains(siteID)) {
      missingSiteIDs.push(siteID);
    }
  });

  return missingSiteIDs;
}

export async function queryInvalidStacksForAnimal(config: DBConfig, animalID: string, stackIDs: number[]): Promise<number[]> {
  if (!stackIDs || stackIDs.length === 0) {
    throw new Error("Parameter stackIDs is empty.");
  }

  const stackIDsJoined = stackIDs.join(", ");

  if (config.dbType == "mssql") {
    return withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
        .input("animalID", sql.VarChar, animalID)
        .query(`
            select distinct st.StackID from Stacks st inner join Experiments e on st.ExpID = e.ExpID
            inner join Sites si on e.SiteID = si.SiteID
            where st.StackID in (${stackIDsJoined}) and si.AnimalID <> @animalID
            order by st.StackID asc;
        `);

      const wrongStackIDs = result.recordset.map((row) => row.StackID as number);
      return wrongStackIDs;
    });
  }
  else {
    const query = `
      select distinct st.stackid from Stacks st inner join Experiments e on st.ExpID = e.ExpID
      inner join Sites si on e.SiteID = si.SiteID
      where st.StackID in (${stackIDsJoined}) and si.AnimalID <> @animalID
      order by st.StackID asc;
    `;

    return withPostgresDatabase(config, async (pool) => {
      const { text, values } = mapPostgresNamedParams(query, { animalID });
      const result = await pool.query(text, values);

      const wrongStackIDs = result.rows.map((row) => row.stackid as number);
      return wrongStackIDs;
    });
  }
}

export async function queryInvalidExperimentsForAnimal(config: DBConfig, animalID: string, expIDs: number[]): Promise<number[]> {
  if (!expIDs || expIDs.length === 0) {
    throw new Error("Parameter expIDs is empty.");
  }

  const expIDsJoined = expIDs.join(", ");

  if (config.dbType == "mssql") {
    return withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
        .input("animalID", sql.VarChar, animalID)
        .query(`
            select distinct e.ExpID from Experiments e
            inner join Sites si on e.SiteID = si.SiteID
            where e.ExpID in (${expIDsJoined}) and si.AnimalID <> @animalID
            order by e.ExpID asc;
        `);

        const wrongExpIDs = result.recordset.map((row) => row.ExpID as number);
        return wrongExpIDs;
    });
  }
  else {
    const query = `
      select distinct e.expid from Experiments e
      inner join Sites si on e.SiteID = si.SiteID
      where e.ExpID in (${expIDsJoined}) and si.AnimalID <> @animalID
      order by e.ExpID asc;
    `;

    return withPostgresDatabase(config, async (pool) => {
      const { text, values } = mapPostgresNamedParams(query, { animalID });
      const result = await pool.query(text, values);

      const wrongExpIDs = result.rows.map((row) => row.expid as number);
      return wrongExpIDs;
    });
  }
}

export async function queryInvalidSitesForAnimal(config: DBConfig, animalID: string, siteIDs: number[]): Promise<number[]> {
  if (!siteIDs || siteIDs.length === 0) {
    throw new Error("Parameter siteIDs is empty.");
  }

  const siteIDsJoined = siteIDs.join(", ");

  if (config.dbType == "mssql") {
    return withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
          .input("animalID", sql.VarChar, animalID)
          .query(`
              SELECT DISTINCT SiteID FROM Sites
              WHERE SiteID IN (${siteIDsJoined}) AND AnimalID <> @animalID
              ORDER BY SiteID ASC;
          `);

      const wrongSiteIDs = result.recordset.map((row) => row.SiteID as number);
      return wrongSiteIDs;
    });
  }
  else {
    const query = `
      SELECT DISTINCT siteid FROM Sites
      WHERE SiteID IN (${siteIDsJoined}) AND AnimalID <> @animalID
      ORDER BY SiteID ASC;
    `;

    return withPostgresDatabase(config, async (pool) => {
      const { text, values } = mapPostgresNamedParams(query, { animalID });
      const result = await pool.query(text, values);

      const wrongSiteIDs = result.rows.map((row) => row.siteid as number);
      return wrongSiteIDs;
    });
  }
}

export async function queryProjects(config: DBConfig): Promise<string[]> {
  if (config.dbType == "mssql") {
    return withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
          .query(`
              SELECT ProjectID FROM Projects
              ORDER BY ProjectID ASC;
          `);

      const projects = result.recordset.map((row) => row.ProjectID as string);
      return projects;
    });
  }
  else {
    const query = `
      SELECT projectid FROM Projects
      ORDER BY ProjectID ASC;
    `;

    return withPostgresDatabase(config, async (pool) => {
      const result = await pool.query(query);

      const projects = result.rows.map((row) => row.projectid as string);
      return projects;
    });
  }
}

export async function queryLocations(config: DBConfig): Promise<string[]> {
  if (config.dbType == "mssql") {
    return withMSSqlDatabase(config, async (pool) => {
      const result = await pool.request()
          .query(`
              SELECT DISTINCT Location FROM Sites
              WHERE DataDeleted = 0
              ORDER BY Location ASC;
          `);

      const locations = result.recordset.map((row) => row.Location as string);
      return locations;
    });
  }
  else {
    const query = `
        SELECT DISTINCT location FROM Sites
        WHERE DataDeleted = false
        ORDER BY Location ASC;
    `;

    return withPostgresDatabase(config, async (pool) => {
      const result = await pool.query(query);

      const locations = result.rows.map((row) => row.location as string);
      return locations;
    });
  }
}

export async function addNewSite(config: DBConfig, siteID: number, animalID: string, project: string, location: string, depth: number | null): Promise<number> {
  const query = "INSERT INTO Sites (SiteID, AnimalID, Project, Location, Depth) VALUES (@SiteID, @AnimalID, @Project, @Location, @Depth);";
  const params = { SiteID: siteID, AnimalID: animalID, Project: project, Location: location, Depth: depth };
  return await executeNonQuery(config, query, params); // mssql vs postgres handled in executeNonQuery
}