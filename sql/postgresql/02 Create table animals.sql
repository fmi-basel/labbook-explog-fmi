CREATE TABLE public.animals (
    animalid     VARCHAR(255) NOT NULL,
    gender       VARCHAR(255) DEFAULT 'F',
    strain       VARCHAR(255) DEFAULT 'C57BL/6J',
    dob          TIMESTAMP NULL,
    dod          TIMESTAMP NULL,
    source       VARCHAR(255),
    vivariumid   INTEGER,
    pi           VARCHAR(255),
    comment      TEXT,
    pyratid      VARCHAR(255),
    datadeleted  BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT animals_pkey PRIMARY KEY (animalid),
    CONSTRAINT fk_animals_pis FOREIGN KEY (pi)
        REFERENCES public.pis (pi)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);
