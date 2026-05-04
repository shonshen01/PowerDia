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
