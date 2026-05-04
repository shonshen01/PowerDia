SELECT
    db.oid as did, db.datname as name, ta.spcname as spcname, db.datallowconn,
    db.datistemplate AS is_template,
    pg_catalog.has_database_privilege(db.oid, 'CREATE') as cancreate, datdba as owner,
    descr.description
FROM
    pg_catalog.pg_database db
    LEFT OUTER JOIN pg_catalog.pg_tablespace ta ON db.dattablespace = ta.oid
    LEFT OUTER JOIN pg_catalog.pg_shdescription descr ON (
        db.oid=descr.objoid AND descr.classoid='pg_database'::regclass
    )
WHERE {% if did %}
db.oid = {{ did|qtLiteral(conn) }}::OID
{% endif %}
{% if not did %}
    db.datname = 'powerwd'
{% endif %}
ORDER BY datname;
