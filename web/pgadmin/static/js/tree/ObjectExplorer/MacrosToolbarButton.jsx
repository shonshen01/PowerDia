/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
////////////////////////////////////////////////////////////

import React, { useCallback, useEffect, useState } from 'react';
import { usePgAdmin } from '../../PgAdminProvider';
import { PgIconButton } from '../../components/Buttons';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import { PgMenu, PgMenuItem } from '../../components/Menu';
import gettext from 'sources/gettext';
import PropTypes from 'prop-types';
import CustomPropTypes from '../../custom_prop_types';
import getApiInstance from '../../api_instance';
import url_for from 'sources/url_for';
import SQLEditor from '../../../../tools/sqleditor/static/js/SQLEditorModule';

/**
 * A reusable component that renders the Macros button and its associated dropdown menu
 * for the Object Explorer Toolbar.
 * Using forwardRef to ensure compatibility with MUI ButtonGroup.
 */
const MacrosToolbarButton = React.forwardRef(({ disabled, shortcut, ...props }, ref) => {
  const [macros, setMacros] = useState([]);
  const api = getApiInstance();
  const pgAdmin = usePgAdmin();

  // Load the macros on mount
  useEffect(() => {
    api.get(url_for('sqleditor.get_user_macros'))
      .then((res) => {
        setMacros(res.data || []);
      })
      .catch(() => {
        /* Failed to fetch macros */
      });
  }, []);

  /**
   * Executes the macro by routing the raw SQL through the native tool launch event.
   * This bypasses localStorage and ensures the SQL is securely passed to the new panel.
   */
  const executeMacro = useCallback((m) => {
    const t = pgAdmin.Browser.tree;
    const i = t?.selected();

    // Launch the Query Tool with the raw macro SQL directly
    SQLEditor.getInstance().showQueryTool('', i, null, undefined, m.sql);
  }, [pgAdmin]);

  return (
    <PgMenu
      portal={true}
      menuButton={
        <PgIconButton
          ref={ref}
          {...props}
          title={gettext('Queries')}
          icon={<><FormatListNumberedRoundedIcon /><KeyboardArrowDownIcon style={{ marginLeft: '-10px' }} /></>}
          disabled={disabled}
          shortcut={shortcut}
          name="menu-macros"
        />
      }
      label={gettext('Queries Menu')}
    >
      {macros.length === 0 && (
        <PgMenuItem disabled>{gettext('No queries defined')}</PgMenuItem>
      )}
      {macros.map((m) => (
        <PgMenuItem
          key={m.name}
          onClick={() => executeMacro(m)}
        >
          {m.name}
        </PgMenuItem>
      ))}
    </PgMenu>
  );
});

MacrosToolbarButton.displayName = 'MacrosToolbarButton';

MacrosToolbarButton.propTypes = {
  disabled: PropTypes.bool,
  shortcut: CustomPropTypes.shortcut,
};

export default MacrosToolbarButton;
