# Troubleshooting Rocky Linux Connection & Auto-Provisioning Plans

This document serves as a complete record of the troubleshooting process for connecting PowerDia to PostgreSQL on Rocky Linux, including the final architectural plans for auto-provisioning new users.

---

## 1. The Core Issue: Web User vs. Database Role
When migrating to Rocky Linux and changing the primary email to `powerwiringdiagram@gmail.com`, the user encountered two issues:
1.  **No Server shown in the tree:** The PowerDia user workspace was blank.
2.  **No Auto-Discovery:** PowerDia failed to automatically detect the local PostgreSQL instance.

### The Underlying Cause
*   **Web User (PowerDia):** The account used to log into `http://127.0.0.1:5051`. This is stored in SQLite (`pgadmin4-server.db`). Server registrations are strictly private to the web user who creates them. A new email means an empty workspace.
*   **Database Role (PostgreSQL):** The actual account inside the PostgreSQL engine used to query tables. This is stored in Postgres (`pg_roles`).
*   **The Problem:** `powerwiringdiagram@gmail.com` was successfully created as a Web User, but it did not automatically exist as a Database Role, and no server had been registered mapping the two together.

---

## 2. Fixing Local Server Auto-Discovery
On Linux, pgAdmin relies on a specific file to trigger auto-discovery. If this is missing (common depending on how PostgreSQL was installed on Rocky Linux), discovery fails silently.

**Solution:** Create the `/etc/postgres-reg.ini` file.

```bash
# Example contents for /etc/postgres-reg.ini
[PostgreSQL/16]
Description=PostgreSQL 16
Superuser=postgres
Port=5432
DataDirectory=/var/lib/pgsql/16/data
```
*Note: This makes the server appear in the connection tree for new users, but they still must provide a valid database password to connect.*

---

## 3. Provisioning a Database Master User (Manual Method)
To allow a new email address to connect to the database and act with full permissions, three specific terminal commands must be run as the PostgreSQL superuser.

```sql
-- 1. Create the database login role (The Identity)
CREATE ROLE "newuser@gmail.com" WITH LOGIN PASSWORD 'their_password' INHERIT;

-- 2. Grant table/schema ownership permissions (The VIP Badge)
GRANT grid_master TO "newuser@gmail.com";

-- 3. Allow connection to the specific database (The Front Door)
GRANT CONNECT ON DATABASE powerwd TO "newuser@gmail.com";
```

### Why `GRANT CONNECT` was used
While `grid_master` (as the database owner) inherently possesses `CONNECT` privileges, explicitly granting `CONNECT` to the user acts as a fail-safe. In locked-down server environments (like production Rocky Linux machines), administrators often revoke public database access (`REVOKE CONNECT FROM PUBLIC`). This explicit grant ensures the inherited role is never accidentally locked out.

---

## 4. Moving to Automation: Auto-Provisioning Plans
To prevent having to run terminal commands every time an admin creates a new user in the PowerDia User Management UI, we developed a **Full-Stack Auto-Provisioning** architecture. 

It uses a Python hook on the web app to trigger a stored function inside PostgreSQL.

### Plan A — `SECURITY DEFINER` Function (Explicit CONNECT - "The Precise Lock")
Every new user is individually granted `CONNECT` access to `powerwd`.

**One-Time Terminal Setup:**
```sql
CREATE OR REPLACE FUNCTION public.provision_powerdia_user(p_email TEXT, p_password TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_email) THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L INHERIT', p_email, p_password);
    END IF;
    EXECUTE format('GRANT grid_master TO %I', p_email);
    EXECUTE format('GRANT CONNECT ON DATABASE powerwd TO %I', p_email);
    RETURN 'User provisioned successfully.';
END;
$$;
```

### Plan B — `GRANT CONNECT TO PUBLIC` ("The Open Lobby")
The `powerwd` database connection is opened to all PostgreSQL roles. The function is simplified.

**One-Time Terminal Setup:**
```sql
-- Run once forever
GRANT CONNECT ON DATABASE powerwd TO PUBLIC;

-- Create Simplified Function
CREATE OR REPLACE FUNCTION public.provision_powerdia_user(p_email TEXT, p_password TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_email) THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L INHERIT', p_email, p_password);
    END IF;
    EXECUTE format('GRANT grid_master TO %I', p_email);
    RETURN 'User provisioned successfully.';
END;
$$;
```

### The Universal Python Backend Hooks
Regardless of whether Plan A or Plan B is chosen, the Python code injected into the PowerDia backend remains identical.

**Phase 1: On-Registration Hook (`user_management/__init__.py`)**
Executes the stored function the moment the user is created in the SQLite database, using their supplied web password.
```python
cur.execute("SELECT public.provision_powerdia_user(%s, %s)", (email, password))
```

**Phase 2: On-First-Login Hook (`pgadmin/__init__.py`)**
Automatically registers the `PowerDia` server node in the user's private workspace upon their first login, saving their password natively so they never see a connection prompt.

---

## 5. Recommendation Summary
*   **Ubuntu (Local Development):** Use **Plan B**. It is simpler and perfectly secure for a machine not exposed to a network.
*   **Rocky Linux (Production Server):** Use **Plan A**. Explicitly granting `CONNECT` per-user is the mathematically correct security posture for a live deployment.
