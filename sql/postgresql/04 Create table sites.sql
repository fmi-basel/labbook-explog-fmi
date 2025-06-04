CREATE TABLE public.sites (
    siteid       INTEGER NOT NULL,
    animalid     VARCHAR(255) NOT NULL,
    project      VARCHAR(255) NOT NULL,
    location     VARCHAR(255) NOT NULL,
    depth        INTEGER,
    datadeleted  BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT pk_sites PRIMARY KEY (siteid),
    CONSTRAINT fk_sites_animals FOREIGN KEY (animalid)
        REFERENCES public.animals (animalid)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_sites_projects FOREIGN KEY (project)
        REFERENCES public.projects (projectid)
        ON UPDATE CASCADE
);
