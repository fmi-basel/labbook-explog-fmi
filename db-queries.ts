import * as sql from "mssql";

export interface DBConfig {
    user: string;
    password: string;
    server: string;
    database: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
  }

export interface SiteItem {
    siteID: number;
    displayText: string;
}

// Internal utility function handling ConnectionPool and query execution
async function withDatabase<T>(
  config: DBConfig,
  callback: (pool: sql.ConnectionPool) => Promise<T>
): Promise<T> {
  const pool = new sql.ConnectionPool({
      user: config.user,
      password: config.password,
      server: config.server,
      database: config.database,
      options: {
          encrypt: config.encrypt,
          trustServerCertificate: config.trustServerCertificate,
      },
  });

  const poolConnect = pool.connect();

  pool.on("error", (err) => {
      console.error("SQL Pool Error: ", err);
      throw new Error(`SQL Pool Error: ${err.message}`);
  });

  try {
      await poolConnect; // Ensure pool connection is established
      const result = await callback(pool); // Execute query logic using the pool
      return result;
  } catch (err) {
      console.error("SQL Error", err);
      throw new Error(`SQL Error: ${err.message}`);
  } finally {
      await pool.close(); // Ensure the connection pool is closed
  }
}

export async function queryPIs(config: DBConfig): Promise<string[]> {
  return withDatabase(config, async (pool) => {
    const result = await pool.request()
      .query('select distinct PI from dbo.Animals where PI is not NULL and DataDeleted = 0 order by PI asc;');

      console.log('Query Results (PIs):', result.recordset);
      return result.recordset.map((row) => row.PI as string); // Return the query result
  });
}

export async function queryAnimals(config: DBConfig, pi: string): Promise<string[]> {
  return withDatabase(config, async (pool) => {
    const result = await pool.request()
      .input("pi", sql.VarChar, pi)
      .query("select AnimalID from dbo.Animals where PI is not NULL and PI = @pi and DataDeleted = 0 order by AnimalID asc;");

    console.log('Query Results (Animals):', result.recordset);
    return result.recordset.map((row) => row.AnimalID as string); // Return the query result
  });
}

export async function existsAnimal(config: DBConfig, animalID: string): Promise<boolean> {
  return withDatabase(config, async (pool) => {
    const result = await pool.request()
      .input("animalID", sql.VarChar, animalID)
      .query("select count(*) as Cnt from dbo.Animals where AnimalID = @animalID and DataDeleted = 0;");

    const count = result.recordset[0]?.Cnt;
    console.log('Exists Result (Animal):', count > 0);

    return count > 0;
  });
}

export async function querySites(config: DBConfig, animalID: string): Promise<SiteItem[]> {
  return withDatabase(config, async (pool) => {
    const result = await pool.request()
      .input("animalID", sql.Int, animalID)
      .query(`
        select s.SiteID, (cast(s.SiteID as varchar(10)) + ':' + (case when st.Comment is not NULL then left(st.Comment, 50) else '' end)) as Display from dbo.Sites s
        inner join Experiments e on s.SiteID = e.SiteID
        inner join Stacks st on e.ExpID = st.ExpID
        where s.AnimalID = @animalID and e.ExpID = st.StackID and s.DataDeleted = 0
        order by s.SiteID, st.Comment asc;
      `);

      console.log('Query Results (Sites):', result.recordset);

      // Return the query result
      return result.recordset.map((row) => ({
        siteID: row.SiteID,
        displayText: row.Display,
      }));
  });
}

export async function queryMissingSites(config: DBConfig, siteIDs: number[]): Promise<number[]> {
  if (!siteIDs || siteIDs.length === 0) {
    throw new Error("Parameter siteIDs is empty.");
  }

  return withDatabase(config, async (pool) => {
    const siteIDsJoined = siteIDs.join(", ");

    const result = await pool.request()
      .query(`
        select s.SiteID from dbo.Sites s
        where s.SiteID in (${siteIDsJoined})
        order by s.SiteID asc;
      `);

    const existingSiteIDs = result.recordset.map((row) => row.SiteID as number);

    // No matching siteIDs
    if (!existingSiteIDs || existingSiteIDs.length === 0) {
      return siteIDs;
    }

    // Check all provided siteIDs against the result
    let missingSiteIDs: number[] = [];
    siteIDs.forEach(siteID => {
      if (!existingSiteIDs.contains(siteID)) {
        missingSiteIDs.push(siteID);
      }
    });

    return missingSiteIDs;
  });
}

export async function queryInvalidStacksForAnimal(config: DBConfig, animalID: string, stackIDs: number[]): Promise<number[]> {
  if (!stackIDs || stackIDs.length === 0) {
    throw new Error("Parameter stackIDs is empty.");
  }

  return withDatabase(config, async (pool) => {
    const stackIDsJoined = stackIDs.join(", ");

    const result = await pool.request()
      .input("animalID", sql.VarChar, animalID)
      .query(`
          select distinct st.StackID from dbo.Stacks st inner join dbo.Experiments e on st.ExpID = e.ExpID
          inner join dbo.Sites si on e.SiteID = si.SiteID
          where st.StackID in (${stackIDsJoined}) and si.AnimalID <> @animalID
          order by st.StackID asc;
      `);

    const wrongStackIDs = result.recordset.map((row) => row.StackID as number);
    return wrongStackIDs;
  });
}

export async function queryInvalidExperimentsForAnimal(config: DBConfig, animalID: string, expIDs: number[]): Promise<number[]> {
  if (!expIDs || expIDs.length === 0) {
    throw new Error("Parameter expIDs is empty.");
  }

  return withDatabase(config, async (pool) => {
    const expIDsJoined = expIDs.join(", ");

    const result = await pool.request()
      .input("animalID", sql.VarChar, animalID)
      .query(`
          select distinct e.ExpID from dbo.Experiments e
          inner join dbo.Sites si on e.SiteID = si.SiteID
          where e.ExpID in (${expIDsJoined}) and si.AnimalID <> @animalID
          order by e.ExpID asc;
      `);

      const wrongExpIDs = result.recordset.map((row) => row.ExpID as number);
      return wrongExpIDs;
  });
}

export async function queryInvalidSitesForAnimal(config: DBConfig, animalID: string, siteIDs: number[]): Promise<number[]> {
  if (!siteIDs || siteIDs.length === 0) {
    throw new Error("Parameter siteIDs is empty.");
  }

  return withDatabase(config, async (pool) => {
    const siteIDsJoined = siteIDs.join(", ");

    const result = await pool.request()
        .input("animalID", sql.VarChar, animalID)
        .query(`
            SELECT DISTINCT SiteID FROM dbo.Sites
            WHERE SiteID IN (${siteIDsJoined}) AND AnimalID <> @animalID
            ORDER BY SiteID ASC;
        `);

    const wrongSiteIDs = result.recordset.map((row) => row.SiteID as number);
    return wrongSiteIDs;
  });
}

export async function queryProjects(config: DBConfig): Promise<string[]> {
  return withDatabase(config, async (pool) => {
    const result = await pool.request()
        .query(`
            SELECT DISTINCT Project FROM dbo.Sites
            WHERE DataDeleted = 0
            ORDER BY Project ASC;
        `);

    const projects = result.recordset.map((row) => row.Project as string);
    return projects;
  });
}

export async function queryLocations(config: DBConfig): Promise<string[]> {
  return withDatabase(config, async (pool) => {
    const result = await pool.request()
        .query(`
            SELECT DISTINCT Location FROM dbo.Sites
            WHERE DataDeleted = 0
            ORDER BY Location ASC;
        `);

    const locations = result.recordset.map((row) => row.Location as string);
    return locations;
  });
}

export async function addNewSite(config: DBConfig, animalID: string, project: string, location: string, depth: number | null): Promise<void> {

}