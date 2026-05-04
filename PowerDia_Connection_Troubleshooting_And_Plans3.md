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

---

## 6. Authentication Hook (How Python connects to Postgres)
To execute the `provision_powerdia_user()` function from the pgAdmin user management UI, the Python backend needs a way to authenticate to PostgreSQL. Here is the comparison of the two main approaches:

### Option 1: Hardcoding in `config_local.py`
Add `PROVISIONDB_PASS = 'MySecretPass123'` into `/home/hawar/pgadmin4-master/web/config_local.py`.
*   **Security Risk:** **Moderate**. Password saved in plaintext in a code file. If someone copies your project folder (like to a USB), they capture the server password.
*   **Portability:** **Low**. You must manually edit the code file on every server.
*   **Best For:** Development machines with strict permissions.

### Option 2: System Environment Variable
Store the password inside the Rocky Linux OS (e.g. `export PROVISIONDB_PASS="MySecretPass123"` in a `.bashrc` or `systemd` service file). Python reads it via `os.environ.get('PROVISIONDB_PASS')`.
*   **Security Risk:** **Low (Safest)**. Code files are clean. Attackers need live system root access to intercept the variable.
*   **Portability:** **Excellent**. The code is identical everywhere; each server injects its own secret securely.
*   **Best For:** Production environments like Rocky Linux deployments.

---

## 7. Final Complete Implementation Plan (Code Injection)
*This section contains the precise, production-ready code to integrate Plan A with Option 2 (Environment Variable Authentication) into the PowerDia source code.*

### Step 0: One-Time Database Setup (Run Once in Terminal)
```bash
sudo -u postgres psql -d powerwd -c "
CREATE OR REPLACE FUNCTION public.provision_powerdia_user(
    p_email TEXT,
    p_password TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_email) THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L INHERIT', p_email, p_password);
    END IF;
    EXECUTE format('GRANT grid_master TO %I', p_email);
    EXECUTE format('GRANT CONNECT ON DATABASE powerwd TO %I', p_email);
    RETURN 'User ' || p_email || ' provisioned successfully.';
END;
\$\$;
"
```

### Step 1: Set the Environment Variable
**On Rocky Linux (Production Server):**
Edit your service file (e.g. `/etc/systemd/system/powerdia.service`):
```ini
[Service]
Environment="PROVISIONDB_PASS=YourPostgresAdminPassword"
```
Reload systemd: `sudo systemctl daemon-reload && sudo systemctl restart powerdia`

### Step 2: Add Config Variable 
Modify `web/config_local.py`:
```python
# --- PowerDia Auto-Provisioning ---
POWERDIA_AUTO_PROVISION = True
```

### Step 3: On-Registration Hook (Modify `web/pgadmin/tools/user_management/__init__.py`)
Add this helper function just **before** `_create_new_user` (around line 639):
```python
# ── PowerDia: Auto-Provision DB Role ─────────────────────────────────────────
def _provision_postgres_role(email, plain_password):
    import os
    import psycopg

    if not getattr(config, 'POWERDIA_AUTO_PROVISION', False): return
    db_pass = os.environ.get('PROVISIONDB_PASS')
    if not db_pass: return

    try:
        conn_str = f"host=127.0.0.1 port=5432 dbname=powerwd user=postgres password={db_pass}"
        with psycopg.connect(conn_str) as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SELECT public.provision_powerdia_user(%s, %s)", (email, plain_password))
    except Exception as e:
        current_app.logger.warning("PowerDia provisioning failed: %s", str(e))
# ─────────────────────────────────────────────────────────────────────────────
```
Modify `create_user()` to call the hook (replace lines 698-701):
```python
    try:
        _create_new_user(new_data)
    except Exception as e:
        return False, str(e)

    create_users_storage_directory()

    # ── PowerDia: Provision the matching PostgreSQL role ──────────────────────
    plain_password = data.get('newPassword', '')
    email = data.get('email', '')
    if email and plain_password:
        _provision_postgres_role(email, plain_password)
    # ─────────────────────────────────────────────────────────────────────────

    return True, ''
```

### Step 4: On-First-Login Hook (Modify `web/pgadmin/__init__.py`)
Insert a new `@user_logged_in` block **after** `store_crypt_key` (around line 735):
```python
    # ── PowerDia: Auto-Register Server on First Login ─────────────────────────
    @user_logged_in.connect_via(app)
    def auto_register_powerdia_server(sender, user):
        if not getattr(config, 'POWERDIA_AUTO_PROVISION', False): return
        try:
            if Server.query.filter_by(user_id=user.id).first(): return
            first_group = ServerGroup.query.filter_by(user_id=user.id).order_by(ServerGroup.id).first()
            if not first_group: return

            svr = Server(
                user_id=user.id, servergroup_id=first_group.id, name='PowerDia',
                host='127.0.0.1', port=5432, maintenance_db='powerwd', username=user.email,
                connection_params={'sslmode': 'prefer', 'connect_timeout': 10},
                comment='Auto-registered by PowerDia'
            )
            db.session.add(svr)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
    # ─────────────────────────────────────────────────────────────────────────
```
# Implementation Plan: Auto-Provisioning (Plan A + Environment Variable Auth)

## Overview
This plan combines two decisions:
- **Plan A** — Each new user is individually granted explicit `CONNECT` access to `powerwd` via a `SECURITY DEFINER` PL/pgSQL function. Best for production Rocky Linux servers.
- **Option 2** — The Python backend authenticates to PostgreSQL using a password read from a **System Environment Variable** (`PROVISIONDB_PASS`), never hardcoded in code files.

This plan also includes complete lifecycle hooks for **Auto-Registration**, **Auto-Deprovisioning (Teardown)**, and **Global Macro Sharing**.

---

## Step 0: One-Time Database Setup (Run Once in Terminal)

Run this command to create the stored functions in PostgreSQL for both provisioning and teardown.

```bash
sudo -u postgres psql -d powerwd -c "
-- Function 1: Provisioning
CREATE OR REPLACE FUNCTION public.provision_powerdia_user(
    p_email TEXT,
    p_password TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_email) THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L INHERIT', p_email, p_password);
    END IF;
    EXECUTE format('GRANT grid_master TO %I', p_email);
    EXECUTE format('GRANT CONNECT ON DATABASE powerwd TO %I', p_email);
    RETURN 'User ' || p_email || ' provisioned successfully.';
END;
\$\$;

-- Function 2: Deprovisioning (Teardown)
CREATE OR REPLACE FUNCTION public.deprovision_powerdia_user(p_email TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS \$\$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_email) THEN
        EXECUTE format('REVOKE grid_master FROM %I', p_email);
        EXECUTE format('REVOKE CONNECT ON DATABASE powerwd FROM %I', p_email);
        EXECUTE format('DROP ROLE %I', p_email);
        RETURN 'Deprovisioned: ' || p_email;
    END IF;
    RETURN 'No DB role found for: ' || p_email;
END;
\$\$;
"
```

---

## Step 1: Set the Environment Variable on Your Server

### On Ubuntu (Development Machine)
```bash
export PROVISIONDB_PASS="YourPostgresAdminPassword"
```

### On Rocky Linux (Production Server)
Edit your service file (e.g. `/etc/systemd/system/powerdia.service`):
```ini
[Service]
Environment="PROVISIONDB_PASS=YourPostgresAdminPassword"
```
```bash
sudo systemctl daemon-reload
sudo systemctl restart powerdia
```

---

## Step 2: Add Config Variable (Safety Flag)

#### [MODIFY] `web/config_local.py`
```python
# --- PowerDia Auto-Provisioning ---
POWERDIA_AUTO_PROVISION = True
```

---

## Step 3: On-Registration & On-Delete Hooks (User Lifecycle)

These hooks fire when an Admin creates or deletes a user via the PowerDia Web UI.

#### [MODIFY] `web/pgadmin/tools/user_management/__init__.py`

**Insert before `_create_new_user`:**
```python
# ── PowerDia: Auto-Provision DB Role ─────────────────────────────────────────
def _provision_postgres_role(email, plain_password):
    import os, psycopg
    if not getattr(config, 'POWERDIA_AUTO_PROVISION', False): return
    db_pass = os.environ.get('PROVISIONDB_PASS')
    if not db_pass: return

    try:
        conn_str = f"host=127.0.0.1 port=5432 dbname=powerwd user=postgres password={db_pass}"
        with psycopg.connect(conn_str) as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SELECT public.provision_powerdia_user(%s, %s)", (email, plain_password))
    except Exception as e:
        current_app.logger.warning("PowerDia provisioning failed (Check database service or password): %s", str(e))
# ─────────────────────────────────────────────────────────────────────────────

# ── PowerDia: Deprovision DB Role ────────────────────────────────────────────
def _deprovision_postgres_role(email):
    import os, psycopg
    if not getattr(config, 'POWERDIA_AUTO_PROVISION', False): return
    db_pass = os.environ.get('PROVISIONDB_PASS')
    if not db_pass: return

    try:
        conn_str = f"host=127.0.0.1 port=5432 dbname=powerwd user=postgres password={db_pass}"
        with psycopg.connect(conn_str) as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SELECT public.deprovision_powerdia_user(%s)", (email,))
    except Exception as e:
        current_app.logger.warning("PowerDia teardown failed (Check database service or password): %s", str(e))
# ─────────────────────────────────────────────────────────────────────────────
```

**Trigger the Provisioning Hook** (Inside `create_user`, replacing lines 698-701):
```python
    try:
        _create_new_user(new_data)
    except Exception as e:
        return False, str(e)

    create_users_storage_directory()

    # ── PowerDia: Provision the matching PostgreSQL role ──────────────────────
    plain_password = data.get('newPassword', '')
    email = data.get('email', '')
    if email and plain_password:
        _provision_postgres_role(email, plain_password)
    # ─────────────────────────────────────────────────────────────────────────

    return True, ''
```

**Trigger the Deprovisioning Hook** (Inside `delete_user`, replacing lines 795-802):
```python
        # Finally delete user
        user_email_for_cleanup = usr.email
        db.session.delete(usr)

        db.session.commit()
    except Exception as e:
        return False, str(e)

    # ── PowerDia: Deprovision the matching PostgreSQL role ────────────────────
    if user_email_for_cleanup:
        _deprovision_postgres_role(user_email_for_cleanup)
    # ─────────────────────────────────────────────────────────────────────────

    return True, ''
```

---

## Step 4: On-First-Login Hook (Auto-Registration)

Automatically add the PowerDia server to the user's workspace on first login.

#### [MODIFY] `web/pgadmin/__init__.py`

**Insert after `store_crypt_key`:**
```python
    # ── PowerDia: Auto-Register Server on First Login ─────────────────────────
    @user_logged_in.connect_via(app)
    def auto_register_powerdia_server(sender, user):
        if not getattr(config, 'POWERDIA_AUTO_PROVISION', False): return
        try:
            if Server.query.filter_by(user_id=user.id).first(): return
            first_group = ServerGroup.query.filter_by(user_id=user.id).order_by(ServerGroup.id).first()
            if not first_group: return

            svr = Server(
                user_id=user.id, servergroup_id=first_group.id, name='PowerDia',
                host='127.0.0.1', port=5432, maintenance_db='powerwd', username=user.email,
                connection_params={'sslmode': 'prefer', 'connect_timeout': 10},
                comment='Auto-registered by PowerDia'
            )
            db.session.add(svr)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
    # ─────────────────────────────────────────────────────────────────────────
```

---

## Step 5: Global Macros Sharing (Option A)

Allow all users to read and execute the SQL Macros created by the Administrator (`uid=1`).

#### [MODIFY] `web/pgadmin/tools/sqleditor/utils/macros.py`

**Modify `get_user_macros` filter:**
```python
# [BEFORE]
        UserMacros.uid == current_user.id).order_by(UserMacros.name).all()

# [AFTER]
        (UserMacros.uid == current_user.id) | (UserMacros.uid == 1)).order_by(UserMacros.name).all()
```
