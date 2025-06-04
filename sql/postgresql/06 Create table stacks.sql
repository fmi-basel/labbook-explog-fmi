CREATE TABLE public.stacks (
    stackid       INTEGER NOT NULL,
    stackdate     TIMESTAMP,
    stacktime     VARCHAR(255),
    expid         INTEGER,
    comment       TEXT,
    datadeleted   BOOLEAN NOT NULL DEFAULT FALSE,
    paradigm      VARCHAR(500),
    CONSTRAINT stacks_pkey PRIMARY KEY (stackid),
    CONSTRAINT fk_stacks_experiments FOREIGN KEY (expid)
        REFERENCES public.experiments (expid)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);
