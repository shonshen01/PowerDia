W# PowerDia Extraction and Customization Notes

This document will serve as a persistent, local record of our conversations, technical decisions, and ongoing tasks related to extracting the "PowerDia" customizations from the core pgAdmin 4 source code.

## Current Context
The original conversation titled **"Extracting PowerDia Customizations"** (ID: `8ea07a53-97e3-4392-876d-fb492f0e0417`) disappeared from the recent UI due to missing metadata. However, the core extraction implementation plan created during that session is fully intact in the system. 

We will use this file going forward to log any new questions, architecture details, or code changes so you have a safe, permanent reference in your workspace.

---

## Technical Log

### March 30, 2026 - Conversation History
- **Issue:** The PowerDia extraction conversation disappeared from the UI list.
- **Cause:** System-level metadata files (`metadata.json`) were lost/missing for that session directory.
- **Resolution:** Confirmed that the `artifacts/implementation_plan.md` remains safely stored. Created this local `powerdia_extraction_notes.md` log file in the master branch to guarantee no future discussions or technical plans are lost.

---

### April 24, 2026 - PostGIS & Database Restoration
- **Goal:** Resolve "extension 'postgis' is not available" error and restore the `powerwd` database.
- **Root Cause:** PostgreSQL 18 was running, but PostGIS 16 was installed. The extension files were in `/usr/pgsql-16/` while the server looked in `/usr/pgsql-18/`.
- **Actions Taken:**
    1.  Installed correct PostGIS package: `sudo dnf install -y postgis36_18`.
    2.  Executed preamble migration (`powerwd_rocky_migration.sql`) to create roles (`grid_master`, etc.) and the `powerwd` database.
    3.  Enabled PostGIS extensions: `CREATE EXTENSION IF NOT EXISTS postgis;` and `CREATE EXTENSION IF NOT EXISTS postgis_topology;`.
    4.  Restored database from `/home/powerdia/powerwd_backup_clean.sql` using `cat` pipe to avoid permission issues for the `postgres` user.
- **Verification:** Database restored successfully with 1,521 users, 117 transformers, and 4,563 consumption readings.

---

---

### April 27, 2026 - Database State Snapshot
- **Database:** `powerwd` (Owner: `postgres`)
- **Roles & Membership:**
    - `grid_master`: Table owner.
    - `powerwiringdiagram@gmail.com`: Member of `grid_master`.
    - `app_developers`: NOLOGIN group.
    - `grid_analyst`: Reporting role.
- **Table Ownership (in powerwd):**
    - `end_users`, `network_distribution`, `ref_transformer_types`, `user_consumption` -> Owned by `grid_master`.
    - `spatial_ref_sys` -> Owned by `postgres`.

---

*(Future questions, code snippets, and decisions will be appended below)*
