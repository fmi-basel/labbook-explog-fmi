CREATE TABLE public.projects (
    projectid   VARCHAR(255) NOT NULL,
    name        VARCHAR(150),
    pis         VARCHAR(150),
    description VARCHAR(1000),
    startdate   TIMESTAMP,
    status      VARCHAR(100) DEFAULT 'In progress',
    CONSTRAINT pk_projects PRIMARY KEY (projectid)
);
