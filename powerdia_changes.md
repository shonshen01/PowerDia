# PowerDia Code Modifications & Scripts

Based on the migration logs and source code differences, here are the key code snippets and scripts that transformed the original `pgadmin4-master` into **PowerDia**.

## 1. UI Refactoring & Branding

### Menu Bar Removal
To create a minimalist interface, the horizontal menu bar was stripped down. The primary configuration array in `MainMenuFactory.js` was emptied to hide standard file/edit menus.

**`web/pgadmin/browser/static/js/MainMenuFactory.js`**
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
The global branding variables were targeted to reflect the PowerDia name across the UI and internal aliases.

**`web/branding.py`**
```python
# Name of the application to display in the UI
# Original: APP_NAME = 'pgAdmin 4'
APP_NAME = 'PowerDia' 
```

**`web/pgadmin/static/js/pgadmin.js`**
```javascript
// Original: let pgAdmin = window.pgAdmin = window.pgAdmin || {};
// PowerDia (Global Alias change):
let pgAdmin = window.powerDia = window.pgAdmin || {};
```

### Workspace Panel Disabling
The left workspace panel was hidden by default to prioritize the dashboard and ERD canvas.

**`web/pgadmin/misc/workspaces/static/js/WorkspaceProvider.jsx`**
```javascript
const defaultWorkspace = {
    // Original: enabled: true,
    enabled: false, // Hardcoded to false for PowerDia
    // ...
};
```

---

## 2. Macros & Keyboard Shortcut Enhancements

A new sub-menu shortcut was added explicitly for opening the Macros menu, allowing the relay mechanism to function.

**`web/pgadmin/browser/register_browser_preferences.py`**
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

**`web/pgadmin/browser/static/js/keyboard.js`**
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

## 3. Database Isolation (Row Level Security & Schema Visibility)

To ensure users only see schemas and databases they own or have usage rights to, the core SQL queries that fetch the object explorer tree were heavily modified.

**`web/pgadmin/browser/server_groups/servers/databases/schemas/templates/schemas/pg/default/sql/nodes.sql`**
```sql
-- Added role validation for schema listing
    NOT (
{{ CATALOGS.LIST('nsp') }}
    )
+   AND pg_has_role(current_user, nsp.nspowner, 'USAGE')
```

**`web/pgadmin/browser/server_groups/servers/databases/templates/databases/sql/default/nodes.sql`**
```sql
-- Locked the database visibility specifically to 'powerwd'
{% if not did %}
    db.datname = 'powerwd'
{% endif %}
```

---

## 4. Auto-Provisioning & Deprovisioning (User Lifecycle)

This is the most critical backend feature. When an administrator creates or deletes a user in the PowerDia UI, the system automatically mirrors that action in PostgreSQL — creating or dropping the matching database role.

### Step 0: The Database-Side PL/pgSQL Functions
These two functions live in the `powerwd` database and must be created once as the `postgres` superuser. They wrap all privileged operations.

```sql
-- Run as: sudo -u postgres psql -d powerwd

-- PROVISION: Creates a DB role and grants it grid_master membership
CREATE OR REPLACE FUNCTION public.provision_powerdia_user(p_email text, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_email) THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', p_email, p_password);
    END IF;
    EXECUTE format('GRANT grid_master TO %I', p_email);
    GRANT CONNECT ON DATABASE powerwd TO %I USING (p_email);
END;
$$;

-- DEPROVISION: Removes the role and revokes all privileges
CREATE OR REPLACE FUNCTION public.deprovision_powerdia_user(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_email) THEN
        EXECUTE format('REVOKE ALL ON DATABASE powerwd FROM %I', p_email);
        EXECUTE format('DROP ROLE %I', p_email);
    END IF;
END;
$$;
```

### Step 1: OS Environment Variable (Rocky Linux systemd service)
The provisioning password is stored securely in the systemd service file, NOT in source code.

```ini
# /etc/systemd/system/powerdia.service
[Service]
Environment="PROVISIONDB_PASS=YourActualPostgresAdminPassword"
```

### Step 2 & 3: On-Registration Hook — `web/pgadmin/tools/user_management/__init__.py`

These two private functions were **added** (lines 639–675) to call the PL/pgSQL functions via `psycopg3`:

```python
# ── PowerDia: Auto-Provision DB Role ─────────────────────────────────────────
def _provision_postgres_role(email, plain_password):
    import os
    import psycopg

    if not getattr(config, 'POWERDIA_AUTO_PROVISION', False): return
    db_pass = os.environ.get('PROVISIONDB_PASS')   # Read from systemd env var
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

# ── PowerDia: Deprovision DB Role ────────────────────────────────────────────
def _deprovision_postgres_role(email):
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
                cur.execute("SELECT public.deprovision_powerdia_user(%s)", (email,))
    except Exception as e:
        current_app.logger.warning("PowerDia teardown failed: %s", str(e))
# ─────────────────────────────────────────────────────────────────────────────
```

The `create_user()` function was **modified** to call the provision hook after user creation:

```python
def create_user(data):
    # ... existing validation and _create_new_user(new_data) ...

    # ── PowerDia: Provision the matching PostgreSQL role ──────────────────────
    plain_password = data.get('newPassword', '')
    email = data.get('email', '')
    if email and plain_password:
        _provision_postgres_role(email, plain_password)   # <── ADDED
    # ─────────────────────────────────────────────────────────────────────────

    return True, ''
```

The `delete_user()` function was **modified** to call the deprovision hook after SQLite deletion:

```python
def delete_user(uid):
    # ... existing cleanup of Server, ServerGroup, Process, SharedServer ...
    user_email_for_cleanup = usr.email   # <── save BEFORE deleting usr
    db.session.delete(usr)
    db.session.commit()

    # ── PowerDia: Deprovision the matching PostgreSQL role ────────────────────
    if user_email_for_cleanup:
        _deprovision_postgres_role(user_email_for_cleanup)   # <── ADDED
    # ─────────────────────────────────────────────────────────────────────────

    return True, ''
```

### Step 4: On-First-Login Hook — `web/pgadmin/__init__.py`

This Flask signal handler was **added** (lines 737–770) so the `powerwd` server connection is auto-registered in SQLite the moment a user logs in for the first time:

```python
# ── PowerDia: Auto-Register Server on First Login ─────────────────────────
@user_logged_in.connect_via(app)
def auto_register_powerdia_server(sender, user):
    if not getattr(config, 'POWERDIA_AUTO_PROVISION', False): return
    try:
        if Server.query.filter_by(user_id=user.id).first(): return  # already registered
        first_group = ServerGroup.query.filter_by(user_id=user.id).order_by(ServerGroup.id).first()
        if not first_group: return

        # Optionally encrypt and save the login password so the server
        # connects automatically without a prompt.
        encrypted_password = None
        if getattr(config, 'ALLOW_SAVE_PASSWORD', False) and \
                session.get('allow_save_password', False):
            plain_password = request.form.get('password', '')
            crypt_key = current_app.keyManager.get()
            if plain_password and crypt_key:
                from pgadmin.utils.crypto import encrypt
                encrypted_password = encrypt(plain_password.encode(), crypt_key)

        svr = Server(
            user_id=user.id, servergroup_id=first_group.id, name='PowerDia',
            host='127.0.0.1', port=5432, maintenance_db='powerwd', username=user.email,
            password=encrypted_password,
            save_password=1 if encrypted_password else 0,
            connection_params={'sslmode': 'prefer', 'connect_timeout': 10},
            comment='Auto-registered by PowerDia'
        )
        db.session.add(svr)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
# ─────────────────────────────────────────────────────────────────────────────
```

### Step 5: Feature Flag in `config_local.py`

The entire system is gated by a single flag that you set in `config_local.py` on the production server:

```python
# web/config_local.py (on Rocky Linux server)
POWERDIA_AUTO_PROVISION = True
```

---

## 5. PgBouncer Dual-Pool Connection Manager

This feature resolves the connection-affinity problem when running multiple Gunicorn worker processes. Instead of each worker holding its own direct connection to PostgreSQL, all connections are routed through a local PgBouncer instance with two separate pools.

### Architecture: The Dual-Pool Model

| Pool | Port | Mode | Used By |
|---|---|---|---|
| Pool 1 | `6432` | **Transaction** | Dashboards, tree nav, macros — stateless |
| Pool 2 | `6433` | **Session** | Query Tool, Debugger — stateful (BEGIN/COMMIT) |

### Change 1: Configuration flags added to `web/config.py` (lines 1053–1076)

```python
# BEFORE: These keys did not exist in the original pgAdmin 4

# AFTER (PowerDia)
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

### Change 2: Connection Intercept in `web/pgadmin/utils/driver/psycopg3/connection.py` (lines 352–392)

The DSN (connection string) is intercepted inside the `connect()` method and rewritten to point to the appropriate PgBouncer pool based on the `conn_id` prefix:

```python
# Inside connect() method, after: connection_string = manager.create_connection_string(...)

# -----------------------------------------------------------------
# PowerDia: PgBouncer Connection Swap
#
# conn_id prefix determines which pool is used:
#   'CONN:' → Query Tool / Debugger → Session Mode pool
#   'DB:'   → Dashboard / tree / Macros → Transaction Mode pool
#
# SSH tunnel connections are excluded (already have a local endpoint).
# -----------------------------------------------------------------
if config.PGBOUNCER_ENABLED and not manager.use_ssh_tunnel:
    import re as _re
    if conn_id.startswith('CONN:'):       # Stateful: Query Tool, Debugger
        _pgb_port = config.PGBOUNCER_SESSION_PORT
    else:                                  # Stateless: DB browsing, dashboard
        _pgb_port = config.PGBOUNCER_TRANSACTION_PORT

    # Rewrite host and port in the DSN string
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
        f"[PgBouncer] conn_id='{conn_id}' → "
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

## 6. Automation Scripts

These scripts were added to handle deployment and environment preparation.

### Server Auto-Discovery Fix Script
This script creates a local registry file so PowerDia automatically detects the PostgreSQL backend on the Rocky Linux server without manual setup.

**`create_postgres_reg.sh`**
```bash
#!/bin/bash
# PowerDia Rocky Linux - Server Auto-Discovery Fix

set -e
PG_VERSION=$(sudo -u postgres psql -tAc "SELECT version();" 2>/dev/null | grep -oP 'PostgreSQL \K[\d]+' || echo "16")
PG_SUPERUSER=$(sudo -u postgres psql -tAc "SELECT usename FROM pg_user WHERE usesuper='t' LIMIT 1;" 2>/dev/null || echo "postgres")
PG_PORT=$(sudo -u postgres psql -tAc "SHOW port;" 2>/dev/null | tr -d ' ' || echo "5432")
PG_DATA=$(sudo -u postgres psql -tAc "SHOW data_directory;" 2>/dev/null | tr -d ' ' || echo "/var/lib/pgsql/${PG_VERSION}/data")

echo "[1/2] Creating /etc/postgres-reg.ini for pgAdmin auto-discovery..."
sudo tee /etc/postgres-reg.ini > /dev/null <<EOF
[PostgreSQL/${PG_VERSION}]
Description=PostgreSQL ${PG_VERSION}
Superuser=${PG_SUPERUSER}
Port=${PG_PORT}
DataDirectory=${PG_DATA}
EOF

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

**`migrate_powerwd.sh`**
```bash
#!/bin/bash
# PowerDia Database Migration Script

DB_NAME="powerwd"
BACKUP_FILE="powerwd_$(date +%Y%m%d_%H%M%S).dump"

echo "[1/3] Generating SQL script for '$DB_NAME' (Public schema only)..."
sudo -u postgres pg_dump -C -v -n public "$DB_NAME" > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "✓ Success: SQL script saved to $BACKUP_FILE"
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
