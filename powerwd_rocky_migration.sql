-- ===========================================================================
-- PowerWD Database Migration Script
-- Source:  Ubuntu 24.04  / PostgreSQL 16
-- Target:  Rocky Linux   / PostgreSQL 18 (fresh installation)
--
-- INSTRUCTIONS (run as the postgres superuser on Rocky Linux):
--
--   Step 1 – Run this preamble FIRST (creates roles + extensions):
--     sudo -u postgres psql -f powerwd_rocky_migration.sql
--
--   Step 2 – Restore the original dump SECOND:
--     sudo -u postgres psql -d powerwd -f powerwd_backup.sql
--
-- NOTE: The \restrict / \unrestrict directives in the original dump are
--       PowerDia-specific psql extensions. When restoring with standard
--       psql on Rocky Linux, add --variable=ON_ERROR_STOP=0 to skip them.
-- ===========================================================================


-- ===========================================================================
-- STEP 0 – Connect to the default 'postgres' database as superuser
-- ===========================================================================
\connect postgres


-- ===========================================================================
-- STEP 1 – CREATE ALL REQUIRED ROLES (idempotent – safe to re-run)
-- ===========================================================================

-- 1a. grid_master  ── the primary application owner role
--     Owns: schema public, all 4 tables, 3 sequences,
--     the electrical_phase TYPE, all constraints, and the GIN index.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grid_master') THEN
        CREATE ROLE grid_master
            LOGIN                    -- allow direct login for app connections
            PASSWORD 'change_me_now' -- !! CHANGE BEFORE GOING TO PRODUCTION !!
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            INHERIT
            CONNECTION LIMIT -1;
        RAISE NOTICE 'Role grid_master created.';
    ELSE
        RAISE NOTICE 'Role grid_master already exists – skipped.';
    END IF;
END
$$;


-- 1b. grid_analyst  ── read-only reporting role
--     Has: USAGE on schema public, SELECT on all 4 tables,
--     and inherited future SELECT via DEFAULT PRIVILEGES.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grid_analyst') THEN
        CREATE ROLE grid_analyst
            LOGIN
            PASSWORD 'change_me_now' -- !! CHANGE BEFORE GOING TO PRODUCTION !!
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            INHERIT
            CONNECTION LIMIT -1;
        RAISE NOTICE 'Role grid_analyst created.';
    ELSE
        RAISE NOTICE 'Role grid_analyst already exists – skipped.';
    END IF;
END
$$;


-- 1c. app_developers  ── full-access developer group role
--     Has: ALL privileges on all 4 tables.
--     Other accounts join this group to inherit its permissions.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_developers') THEN
        CREATE ROLE app_developers
            NOLOGIN                  -- group role; members log in with their own accounts
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            INHERIT;
        RAISE NOTICE 'Role app_developers created.';
    ELSE
        RAISE NOTICE 'Role app_developers already exists – skipped.';
    END IF;
END
$$;


-- 1d. "Your_email"  ── individual user account
--     Created as a LOGIN role and then added as a MEMBER of grid_master,
--     which means this user inherits ALL of grid_master's privileges
--     (ownership of tables, sequences, types, etc.) automatically.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'Your_email') THEN
        CREATE ROLE "your_email"
            LOGIN
            PASSWORD 'change_me_now' -- !! CHANGE BEFORE GOING TO PRODUCTION !!
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            INHERIT
            CONNECTION LIMIT -1;
        RAISE NOTICE 'Role Your_email created.';
    ELSE
        RAISE NOTICE 'Your_email already exists – skipped.';
    END IF;
END
$$;

-- Add Your_email as a MEMBER of grid_master.
-- This grants full inherited rights of grid_master to this user account.
-- WITH ADMIN OPTION allows this user to also grant grid_master membership
-- to other roles if needed. Remove WITH ADMIN OPTION if not required.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_auth_members m
        JOIN pg_roles r  ON r.oid  = m.roleid
        JOIN pg_roles m2 ON m2.oid = m.member
        WHERE r.rolname  = 'grid_master'
          AND m2.rolname = 'Your_email'
    ) THEN
        GRANT grid_master TO "Your_email";
        RAISE NOTICE 'Your_email added as member of grid_master.';
    ELSE
        RAISE NOTICE 'Your_email is already a member of grid_master – skipped.';
    END IF;
END
$$;


-- ===========================================================================
-- STEP 2 – CREATE THE TARGET DATABASE
-- ===========================================================================

-- Uncomment the line below ONLY if you need to re-run this script cleanly:
-- DROP DATABASE IF EXISTS powerwd;

CREATE DATABASE powerwd
    WITH TEMPLATE = template0
    ENCODING         = 'UTF8'
    LOCALE_PROVIDER  = libc
    LOCALE           = 'en_US.UTF-8';

ALTER DATABASE powerwd OWNER TO postgres;
ALTER DATABASE powerwd SET search_path TO '$user', 'public', 'topology';


-- ===========================================================================
-- STEP 3 – INSTALL REQUIRED EXTENSIONS INSIDE powerwd
--           (MUST be done BEFORE restoring the dump, because the
--            network_distribution.geom column uses geometry(Point,4326)
--            which is provided by PostGIS)
--
--           On Rocky Linux, install PostGIS first with:
--             sudo dnf install postgis35_18
-- ===========================================================================
\connect powerwd

-- PostGIS: provides geometry types, spatial_ref_sys table, ST_* functions
CREATE EXTENSION IF NOT EXISTS postgis;

-- PostGIS topology: needed because the search_path references 'topology'
CREATE EXTENSION IF NOT EXISTS postgis_topology;


-- ===========================================================================
-- STEP 4 – GRANT DATABASE CONNECTION RIGHTS
--           All roles need CONNECT permission to enter the database.
-- ===========================================================================
GRANT CONNECT ON DATABASE powerwd TO grid_master;
GRANT CONNECT ON DATABASE powerwd TO grid_analyst;
GRANT CONNECT ON DATABASE powerwd TO app_developers;
GRANT CONNECT ON DATABASE powerwd TO "Your_email";


-- ===========================================================================
-- STEP 5 – OWNERSHIP REFERENCE
--           The dump will apply these automatically. If the restore fails
--           mid-way, run these manually after fixing the problem:
-- ===========================================================================
-- ALTER SCHEMA public                                  OWNER TO grid_master;
-- ALTER TYPE   public.electrical_phase                 OWNER TO grid_master;
-- ALTER TABLE  public.end_users                        OWNER TO grid_master;
-- ALTER SEQUENCE public.end_users_user_id_seq          OWNER TO grid_master;
-- ALTER TABLE  public.network_distribution             OWNER TO grid_master;
-- ALTER SEQUENCE public.network_distribution_node_id_seq OWNER TO grid_master;
-- ALTER TABLE  public.ref_transformer_types            OWNER TO grid_master;
-- ALTER TABLE  public.user_consumption                 OWNER TO grid_master;
-- ALTER SEQUENCE public.user_consumption_reading_id_seq  OWNER TO grid_master;
-- ALTER DEFAULT PRIVILEGES FOR ROLE grid_master IN SCHEMA public
--     GRANT SELECT ON TABLES TO grid_analyst;


-- ===========================================================================
-- DONE – You can now restore the dump:
--   sudo -u postgres psql -d powerwd -f powerwd_backup.sql
-- ===========================================================================
\echo '=================================================='
\echo ' Preamble complete.'
\echo ' Roles created:'
\echo '   grid_master      (owner of all objects)'
\echo '   grid_analyst     (read-only)'
\echo '   app_developers   (full access group)'
\echo '   Your_email  (member of grid_master)'
\echo ''
\echo ' Next step – restore the dump:'
\echo '   sudo -u postgres psql -d powerwd -f powerwd_backup.sql'
\echo '=================================================='
