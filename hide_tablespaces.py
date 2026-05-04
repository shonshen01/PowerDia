import sqlite3

# Updated to use your local pgAdmin development database path
DB_PATH = '/home/powerdia/.pgadmin_dev/pgadmin4-server.db'

try:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Find the preference ID for show_node_tablespace
    cur.execute("SELECT id FROM preferences WHERE name = 'show_node_tablespace'")
    row = cur.fetchone()
    if not row:
        print("ERROR: preference 'show_node_tablespace' not found in database.")
        conn.close()
        exit()

    pref_id = row[0]
    print(f"Found preference id: {pref_id}")

    # Get all user IDs
    cur.execute("SELECT id FROM \"user\"")
    users = cur.fetchall()

    for user in users:
        uid = user[0]
        # Check if this user already has this preference set
        cur.execute("SELECT pid FROM user_preferences WHERE uid=? AND pid=?", (uid, pref_id))
        existing = cur.fetchone()
        if existing:
            cur.execute("UPDATE user_preferences SET value='False' WHERE uid=? AND pid=?", (uid, pref_id))
            print(f"Updated preference for user {uid}")
        else:
            cur.execute("INSERT INTO user_preferences (uid, pid, value) VALUES (?, ?, 'False')", (uid, pref_id))
            print(f"Inserted preference for user {uid}")

    conn.commit()
    print("Done! Tablespaces are now hidden for all current users.")

except sqlite3.Error as e:
    print(f"SQLite error: {e}")
finally:
    if conn:
        conn.close()
