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

The auto-provisioning feature reads the PostgreSQL admin password from a system environment variable (`PROVISIONDB_PASS`). This keeps the password **out of source code** entirely. How you set it depends on your environment.

### On Localhost (Development Machine)
Export the variable in your terminal session before starting the server:

```bash
export PROVISIONDB_PASS="YourPostgresAdminPassword"
source mastervenv/bin/activate
python3 /home/powerdia/PowerDia-master/web/pgAdmin4.py
```

> [!NOTE]
> This export only lasts for the current terminal session. You can add it to your `~/.bashrc` to make it permanent on your dev machine.

### On Rocky Linux (Production Server)
On production, the server is managed by a systemd service. The environment variable is injected via the service file so it is always available — this is the **only reason** the service file is referenced here. It is **not** about auto-launching the server.

Edit the service file:
```bash
sudo nano /etc/systemd/system/powerdia.service
```

Add the following line inside the `[Service]` block:
```ini
[Service]
Environment="PROVISIONDB_PASS=YourActualPostgresAdminPassword"
```

Then reload and restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart powerdia
```

Verify the variable is live:
```bash
sudo systemctl show powerdia.service | grep PROVISIONDB
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

---

## Step 6: UI Refactoring & Branding

### Menu Bar Removal
To create a minimalist interface, the horizontal menu bar was stripped down. The primary configuration array in `MainMenuFactory.js` was emptied to hide standard file/edit menus.

#### [MODIFY] `web/pgadmin/browser/static/js/MainMenuFactory.js`
```javascript
// BEFORE
const MAIN_MENUS = [
  { label: gettext('File'), name: 'file', id: 'mnu_file', index: 0, addSeprator: true, hasDynamicMenuItems: false },
  { label: gettext('Object'), name: 'object', id: 'mnu_obj', index: 1, addSeprator: true, hasDynamicMenuItems: true },
  { label: gettext('Tools'), name: 'tools', id: 'mnu_tools', index: 2, addSeprator: true, hasDynamicMenuItems: false },
  { label: gettext('Help'), name: 'help', id: 'mnu_help', index: 5, addSeprator: false, hasDynamicMenuItems: false }
];

// AFTER (PowerDia)
const MAIN_MENUS = [];
```

### Application Branding

#### [MODIFY] `web/branding.py`
```python
# Name of the application to display in the UI
# Original: APP_NAME = 'pgAdmin 4'
APP_NAME = 'PowerDia'
```

#### [MODIFY] `web/pgadmin/static/js/pgadmin.js`
```javascript
// Original: let pgAdmin = window.pgAdmin = window.pgAdmin || {};
// PowerDia (Global Alias change):
let pgAdmin = window.powerDia = window.pgAdmin || {};
```

### Workspace Panel Disabling
The left workspace panel was hidden by default to prioritize the dashboard and ERD canvas.

#### [MODIFY] `web/pgadmin/misc/workspaces/static/js/WorkspaceProvider.jsx`
```javascript
const defaultWorkspace = {
    // Original: enabled: true,
    enabled: false, // Hardcoded to false for PowerDia
    // ...
};
```

---

## Step 7: Macros & Keyboard Shortcut Enhancements

A new sub-menu shortcut was added explicitly for opening the Macros menu, allowing the relay mechanism to function.

#### [MODIFY] `web/pgadmin/browser/register_browser_preferences.py`
```python
# Added to register_browser_preferences:
self.preference.register(
    'keyboard_shortcuts',
    'sub_menu_macros',
    gettext('Open macros menu'),
    'keyboardshortcut',
    {
        'alt': True,
        'shift': True,
        'control': False,
        'key': {'key_code': 77, 'char': 'm'}
    },
    category_label=PREF_LABEL_KEYBOARD_SHORTCUTS,
    fields=fields
)
```

#### [MODIFY] `web/pgadmin/browser/static/js/keyboard.js`
```javascript
// Shortcut binding added:
bindSubMenuMacros: function () {
  const tree = this.getTreeDetails();

  if (!tree.d)
    return;

  document.querySelector('button[name="menu-macros"]')?.click();
},
```

---

## Step 8: Database Isolation (Row Level Security & Schema Visibility)

To ensure users only see schemas and databases they own or have usage rights to, the core SQL queries that fetch the object explorer tree were modified.

#### [MODIFY] `web/pgadmin/browser/server_groups/servers/databases/schemas/templates/schemas/pg/default/sql/nodes.sql`
```sql
-- Added role validation for schema listing
    NOT (
{{ CATALOGS.LIST('nsp') }}
    )
+   AND pg_has_role(current_user, nsp.nspowner, 'USAGE')
```

#### [MODIFY] `web/pgadmin/browser/server_groups/servers/databases/templates/databases/sql/default/nodes.sql`
```sql
-- Locked the database visibility specifically to 'powerwd'
{% if not did %}
    db.datname = 'powerwd'
{% endif %}
```

---

## Step 9: PgBouncer Dual-Pool Connection Manager

This feature resolves the connection-affinity problem when running multiple Gunicorn worker processes. Instead of each worker holding its own direct connection to PostgreSQL, all connections are routed through a local PgBouncer instance with two separate pools.

### Architecture: The Dual-Pool Model

| Pool | Port | Mode | Used By |
|---|---|---|---|
| Pool 1 | `6432` | **Transaction** | Dashboards, tree nav, macros — stateless |
| Pool 2 | `6433` | **Session** | Query Tool, Debugger — stateful (BEGIN/COMMIT) |

#### [MODIFY] `web/config.py`

Add these configuration flags (after the existing database settings block):

```python
##########################################################################
# PgBouncer Connection Proxy Settings (PowerDia)
#
# When PGBOUNCER_ENABLED is True, PowerDia routes all database connections
# through PgBouncer instead of connecting directly to PostgreSQL.
# Two pools are required: configure PgBouncer with two separate listeners.
#   Pool 1 — Transaction Mode (port 6432): Stateless tools.
#   Pool 2 — Session Mode (port 6433): Stateful tools (Query Tool).
# Leave PGBOUNCER_ENABLED = False for local/development use.
# Set to True in config_local.py on production multi-worker deployments.
##########################################################################
PGBOUNCER_ENABLED = False
PGBOUNCER_HOST = '127.0.0.1'
PGBOUNCER_TRANSACTION_PORT = 6432   # Pool 1: Transaction mode (stateless)
PGBOUNCER_SESSION_PORT = 6433       # Pool 2: Session mode (stateful)
```

#### [MODIFY] `web/pgadmin/utils/driver/psycopg3/connection.py`

Insert inside the `connect()` method, after the `connection_string` is built:

```python
# -----------------------------------------------------------------
# PowerDia: PgBouncer Connection Swap
#
# conn_id prefix determines which pool is used:
#   'CONN:' - Query Tool / Debugger - Session Mode pool
#   'DB:'   - Dashboard / tree / Macros - Transaction Mode pool
#
# SSH tunnel connections are excluded (already have a local endpoint).
# -----------------------------------------------------------------
if config.PGBOUNCER_ENABLED and not manager.use_ssh_tunnel:
    import re as _re
    if conn_id.startswith('CONN:'):       # Stateful: Query Tool, Debugger
        _pgb_port = config.PGBOUNCER_SESSION_PORT
    else:                                  # Stateless: DB browsing, dashboard
        _pgb_port = config.PGBOUNCER_TRANSACTION_PORT

    connection_string = _re.sub(
        r'host=[^\s]+',
        f'host={config.PGBOUNCER_HOST}',
        connection_string
    )
    connection_string = _re.sub(
        r'port=\d+',
        f'port={_pgb_port}',
        connection_string
    )
    current_app.logger.debug(
        f"[PgBouncer] conn_id='{conn_id}' -> "
        f"{config.PGBOUNCER_HOST}:{_pgb_port}"
    )
# -----------------------------------------------------------------
```

### Enabling PgBouncer in Production

```python
# web/config_local.py (on Rocky Linux server)
PGBOUNCER_ENABLED = True
PGBOUNCER_HOST = '127.0.0.1'
PGBOUNCER_TRANSACTION_PORT = 6432
PGBOUNCER_SESSION_PORT = 6433
```

---

## Step 10: Automation Scripts

These scripts were added to handle deployment and environment preparation.

### Server Auto-Discovery Fix Script

This script creates a local registry file so PowerDia automatically detects the PostgreSQL backend on the Rocky Linux server without manual setup.

#### [NEW] `create_postgres_reg.sh`
```bash
#!/bin/bash
# PowerDia Rocky Linux - Server Auto-Discovery Fix

set -e
PG_VERSION=$(sudo -u postgres psql -tAc "SELECT version();" 2>/dev/null | grep -oP 'PostgreSQL \K[\d]+' || echo "16")
PG_SUPERUSER=$(sudo -u postgres psql -tAc "SELECT usename FROM pg_user WHERE usesuper='t' LIMIT 1;" 2>/dev/null || echo "postgres")
PG_PORT=$(sudo -u postgres psql -tAc "SHOW port;" 2>/dev/null | tr -d ' ' || echo "5432")
PG_DATA=$(sudo -u postgres psql -tAc "SHOW data_directory;" 2>/dev/null | tr -d ' ' || echo "/var/lib/pgsql/${PG_VERSION}/data")

echo "[1/2] Creating /etc/postgres-reg.ini for pgAdmin auto-discovery..."
sudo tee /etc/postgres-reg.ini > /dev/null <<REGEOF
[PostgreSQL/${PG_VERSION}]
Description=PostgreSQL ${PG_VERSION}
Superuser=${PG_SUPERUSER}
Port=${PG_PORT}
DataDirectory=${PG_DATA}
REGEOF

echo "[2/2] Ensuring powerwiringdiagram@gmail.com user has DB access..."
sudo -u postgres psql -c "
DO \$\$
BEGIN
  GRANT CONNECT ON DATABASE powerwd TO \"powerwiringdiagram@gmail.com\";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Note: %', SQLERRM;
END
\$\$;
" 2>/dev/null || echo "(Skipped - user may not exist in PostgreSQL yet)"
```

### Database Migration Script

This script manages the extraction and deployment instructions for migrating the `powerwd` database to a new server environment.

#### [NEW] `migrate_powerwd.sh`
```bash
#!/bin/bash
# PowerDia Database Migration Script

DB_NAME="powerwd"
BACKUP_FILE="powerwd_$(date +%Y%m%d_%H%M%S).dump"

echo "[1/3] Generating SQL script for '$DB_NAME' (Public schema only)..."
sudo -u postgres pg_dump -C -v -n public "$DB_NAME" > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "Success: SQL script saved to $BACKUP_FILE"
    USB_PATH="/mnt/antigravity_usb"
    if [ -d "$USB_PATH" ]; then
        sudo cp "$BACKUP_FILE" "$USB_PATH/powerwd_backup.sql"
    fi
else
    exit 1
fi

echo "[2/3] Preparing Rocky Linux (Commands to run on target):"
echo "sudo dnf install -y postgresql-server"
echo "sudo postgresql-setup --initdb"
echo "sudo systemctl enable --now postgresql"

echo "[3/3] To transfer and restore, run these commands:"
echo "sudo -u postgres psql -c \"DROP DATABASE IF EXISTS $DB_NAME;\""
echo "sudo -u postgres psql -c \"CREATE DATABASE $DB_NAME OWNER grid_master;\""
echo "sudo -u postgres psql -d $DB_NAME -c \"CREATE EXTENSION IF NOT EXISTS postgis;\""
echo "sudo -u postgres psql -d $DB_NAME -c \"CREATE EXTENSION IF NOT EXISTS postgis_topology;\""
echo "sudo -u postgres psql -d $DB_NAME -f ~/$BACKUP_FILE"
```
