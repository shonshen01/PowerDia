////////////////////////////////////////////////////////////
//
// PowerDia — Network Configuration Dialog
//
// Allows the user to pick:
//   - A table from the live database
//   - Three columns mapped to Level 1 / 2 / 3 of the hierarchy
//
// Bug fix #1: React NOT imported (modern JSX transform).
// Bug fix #3: Load button is always enabled; validation runs
//             inside handleLoad and shows a clear error message.
//
////////////////////////////////////////////////////////////

import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  CircularProgress,
  Alert,
} from '@mui/material';
import gettext from 'sources/gettext';
import url_for from 'sources/url_for';

export default function NetworkConfigDialog({ transId, sgid, sid, did, api, onLoad, onClose }) {
  const [tables,        setTables]        = useState([]);
  const [columns,       setColumns]       = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [level1Col,     setLevel1Col]     = useState('');
  const [level2Col,     setLevel2Col]     = useState('');
  const [level3Col,     setLevel3Col]     = useState('');
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingCols,   setLoadingCols]   = useState(false);
  const [error,         setError]         = useState(null);

  // ── Fetch all tables once on mount ────────────────────────────────────────
  useEffect(() => {
    setLoadingTables(true);
    api.get(url_for('erd.network_get_tables', {
      trans_id: transId, sgid, sid, did,
    }))
      .then((res) => {
        setTables(res.data.data || []);
        setError(null);
      })
      .catch(() => setError(gettext('Failed to load tables. Check that the ERD session is active.')))
      .finally(() => setLoadingTables(false));
  }, []);

  // ── Fetch columns whenever the selected table changes ─────────────────────
  useEffect(() => {
    if (!selectedTable) { setColumns([]); return; }
    setLoadingCols(true);
    setLevel1Col(''); setLevel2Col(''); setLevel3Col('');
    api.get(url_for('erd.network_get_columns', {
      trans_id: transId, sgid, sid, did,
    }), { params: { table: selectedTable } })
      .then((res) => {
        setColumns(res.data.data || []);
        setError(null);
      })
      .catch(() => setError(gettext('Failed to load columns.')))
      .finally(() => setLoadingCols(false));
  }, [selectedTable]);

  // ── Submit — Fix #3: always enabled, validation inside ───────────────────
  const handleLoad = useCallback(() => {
    if (!selectedTable) {
      setError(gettext('Please select a Table.')); return;
    }
    if (!level1Col || !level2Col || !level3Col) {
      setError(gettext('Please select all three column levels.')); return;
    }
    if (level1Col === level2Col || level2Col === level3Col || level1Col === level3Col) {
      setError(gettext('All three columns must be distinct. You cannot use the same column twice.')); return;
    }
    setError(null);
    onLoad({ table: selectedTable, level1: level1Col, level2: level2Col, level3: level3Col });
  }, [selectedTable, level1Col, level2Col, level3Col, onLoad]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{gettext('Load Network Hierarchy')}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Table selector */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{gettext('Table (schema.table)')}</InputLabel>
          <Select
            value={selectedTable}
            label={gettext('Table (schema.table)')}
            onChange={(e) => setSelectedTable(e.target.value)}
            disabled={loadingTables}
            endAdornment={loadingTables ? <CircularProgress size={18} sx={{ mr: 3 }} /> : null}
          >
            {tables.map((t) => (
              <MenuItem key={t} value={t}>{t}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Level 1 — Root */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{gettext('Level 1 — Root  (e.g. substation_name)')}</InputLabel>
          <Select
            value={level1Col}
            label={gettext('Level 1 — Root  (e.g. substation_name)')}
            onChange={(e) => setLevel1Col(e.target.value)}
            disabled={!columns.length || loadingCols}
            endAdornment={loadingCols ? <CircularProgress size={18} sx={{ mr: 3 }} /> : null}
          >
            {columns.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </Select>
        </FormControl>

        {/* Level 2 — Middle */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{gettext('Level 2 — Middle  (e.g. feeder_id)')}</InputLabel>
          <Select
            value={level2Col}
            label={gettext('Level 2 — Middle  (e.g. feeder_id)')}
            onChange={(e) => setLevel2Col(e.target.value)}
            disabled={!columns.length || loadingCols}
          >
            {columns.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </Select>
        </FormControl>

        {/* Level 3 — Leaf */}
        <FormControl fullWidth>
          <InputLabel>{gettext('Level 3 — Leaf  (e.g. transformer_label)')}</InputLabel>
          <Select
            value={level3Col}
            label={gettext('Level 3 — Leaf  (e.g. transformer_label)')}
            onChange={(e) => setLevel3Col(e.target.value)}
            disabled={!columns.length || loadingCols}
          >
            {columns.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{gettext('Cancel')}</Button>
        {/* Fix #3: no disabled prop — validation inside handleLoad */}
        <Button variant="contained" color="primary" onClick={handleLoad}>
          {gettext('Load Network')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

NetworkConfigDialog.propTypes = {
  transId:  PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  sgid:     PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  sid:      PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  did:      PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  api:      PropTypes.object.isRequired,
  onLoad:   PropTypes.func.isRequired,
  onClose:  PropTypes.func.isRequired,
};
