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

export async function queryPIs(config: DBConfig): Promise<string[]> {
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

    pool.on('error', err => {
        console.error('SQL Pool Error: ', err);
        throw new Error(`SQL Pool Error: ${err.message}`);
    });

    try {
        await poolConnect; // ensures that the pool has been created
        const result = await pool.request()
        .query('select distinct PI from dbo.Animals where PI is not NULL and DataDeleted = 0 order by PI asc;');

        console.log('Query Results (PI):', result.recordset);
        return result.recordset.map((row) => row.PI as string); // Return the query result
    }
    catch (err) {
        console.error('SQL Error', err);
        throw new Error(`SQL Error: ${err.message}`);
    }
    finally {
        await pool.close(); // Properly closes the connection pool
    }
}

export async function queryAnimals(config: DBConfig, pi: string): Promise<string[]> {
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

    pool.on('error', err => {
      console.error('SQL Pool Error: ', err);
      throw new Error(`SQL Pool Error: ${err.message}`);
    });

    try {
      await poolConnect; // ensures that the pool has been created
      const result = await pool.request()
          .input("pi", sql.VarChar, pi)
        .query("select AnimalID from dbo.Animals where PI is not NULL and PI = @pi and DataDeleted = 0 order by AnimalID asc;");

      console.log('Query Results (Animal):', result.recordset);
      return result.recordset.map((row) => row.AnimalID as string); // Return the query result
    }
    catch (err) {
      console.error('SQL Error', err);
      throw new Error(`SQL Error: ${err.message}`);
    }
    finally {
      await pool.close(); // Properly closes the connection pool
    }
}

export async function querySites(config: DBConfig, animalID: string): Promise<SiteItem[]> {
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

    pool.on('error', err => {
      console.error('SQL Pool Error: ', err);
      throw new Error(`SQL Pool Error: ${err.message}`);
    });

    try {
      await poolConnect; // ensures that the pool has been created
      const result = await pool.request()
      .input("animalID", sql.Int, animalID)
      .query(`
        select s.SiteID, (cast(s.SiteID as varchar(10)) + ':' + (case when st.Comment is not NULL then left(st.Comment, 50) else '' end)) as Display from dbo.Sites s
        inner join Experiments e on s.SiteID = e.SiteID
        inner join Stacks st on e.ExpID = st.ExpID
        where s.AnimalID = @animalID and e.ExpID = st.StackID and s.DataDeleted = 0
        order by s.SiteID, st.Comment asc;
      `);

      console.log('Query Results (Site):', result.recordset);

      // Return the query result
      return result.recordset.map((row) => ({
        siteID: row.SiteID,
        displayText: row.Display,
      }));
    }
    catch (err) {
      console.error('SQL Error', err);
      throw new Error(`SQL Error: ${err.message}`);
    }
    finally {
      await pool.close(); // Properly closes the connection pool
    }
}