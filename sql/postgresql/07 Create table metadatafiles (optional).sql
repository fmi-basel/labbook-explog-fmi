CREATE TABLE public.metadatafiles (
    metadataname         VARCHAR(150) NOT NULL,
    projectid            VARCHAR(255) NOT NULL,
    description          VARCHAR(5000),
    recordinglocation    VARCHAR(500),
    stimulationlocation  VARCHAR(500),
    paradigm             VARCHAR(500),
    marker               VARCHAR(500),
    internal             BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT pk_metadatafiles PRIMARY KEY (metadataname),
    CONSTRAINT fk_metadatafiles_projects FOREIGN KEY (projectid)
        REFERENCES public.projects (projectid)
        ON UPDATE CASCADE
);
