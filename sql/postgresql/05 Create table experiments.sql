CREATE TABLE public.experiments (
    expid          INTEGER NOT NULL,
    siteid         INTEGER NOT NULL,
    analysiscode   VARCHAR(255),
    comment        TEXT,
    datadeleted    BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT experiments_pkey PRIMARY KEY (expid),
    CONSTRAINT fk_experiments_sites FOREIGN KEY (siteid)
        REFERENCES public.sites (siteid)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);
