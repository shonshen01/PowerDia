/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { useEffect, useState } from 'react';
import { usePgAdmin } from '../../PgAdminProvider';
import { Badge, Box } from '@mui/material';
import { RowFilterIcon, ViewDataIcon, ERDIcon } from '../../components/ExternalIcon';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded';
import { PgButtonGroup, PgIconButton } from '../../components/Buttons';
import _ from 'lodash';
import PropTypes from 'prop-types';
import CustomPropTypes from '../../custom_prop_types';
import usePreferences from '../../../../preferences/static/js/store';
import gettext from 'sources/gettext';
import SQLEditor from '../../../../tools/sqleditor/static/js/SQLEditorModule';
import ERDModule from '../../../../tools/erd/static/js/ERDModule';
import MacrosToolbarButton from './MacrosToolbarButton';

function ToolbarButton({ label, icon, onClick, isDisabled, ...props }) {
  return (
    <PgIconButton title={label} icon={icon} size="xs" noBorder
      disabled={isDisabled} onClick={onClick} {...props} />
  );
}
ToolbarButton.propTypes = {
  label: PropTypes.string,
  icon: CustomPropTypes.children,
  onClick: PropTypes.func,
  isDisabled: PropTypes.bool,
  shortcut: CustomPropTypes.shortcut,
};

export default function ObjectExplorerToolbar() {
  const [disabledState, setDisabledState] = useState({
    query_tool: true,
    erd: true,
    view_all: true,
    view_filtered: true,
    search_objects: true,
    psql: true,
  });

  const [menus, setMenus] = useState({
    search_objects: undefined,
    psql: undefined,
  });

  const browserPref = usePreferences().getPreferencesForModule('browser');
  const [hasFilters, setHasFilters] = useState(false);
  const pgAdmin = usePgAdmin();

  const checkToolbarState = () => {
    const t = pgAdmin.Browser.tree;
    const i = t?.selected();
    const d = i ? t.itemData(i) : undefined;
    const toolsMenus = pgAdmin.Browser.all_menus_cache?.tools;

    const sqlEditor = SQLEditor.getInstance();
    const erdModule = ERDModule.getInstance();

    // Helper for generic menus (Search/PSQL)
    const isGenericEnabled = (m) => {
      if (!m) return false;
      if (typeof m.enable === 'function') {
        if (m.module) return m.enable.apply(m.module, [d, i]);
        return m.enable(d, i);
      }
      return m.enable;
    };

    const searchObj = toolsMenus?.search_objects;
    const psql = toolsMenus?.psql;

    const newDisabledState = {
      query_tool: !sqlEditor.queryToolMenuEnabled(d),
      erd: !erdModule.erdToolEnabled(d),
      // View Data logic (from SQLEditorModule.js) uses same check for enabled
      view_all: !sqlEditor.viewMenuEnabled(d),
      view_filtered: !sqlEditor.viewMenuEnabled(d),
      search_objects: !isGenericEnabled(searchObj),
      psql: !isGenericEnabled(psql),
    };

    setDisabledState((prev) => {
      if (_.isEqual(prev, newDisabledState)) return prev;
      return newDisabledState;
    });

    const newMenus = {
      search_objects: searchObj ? { ...searchObj, callback: searchObj.callback } : undefined,
      psql: psql ? { ...psql, callback: psql.callback } : undefined,
    };

    setMenus((prev) => {
      if (prev.search_objects?.name === newMenus.search_objects?.name &&
        prev.psql?.name === newMenus.psql?.name) {
        return prev;
      }
      return newMenus;
    });
  };

  useEffect(() => {
    const deregister = pgAdmin.Browser.Events.on('pgadmin:enable-disable-menu-items', _.debounce(checkToolbarState, 300));
    const deregisterMenu = pgAdmin.Browser.Events.on('pgadmin:refresh-app-menu', _.debounce(checkToolbarState, 300));

    // Listen for tool/file closing to update state if needed? Not heavily needed for toolbar state but good practice?
    // Actually the standard events cover selection changes.

    const deregisterFilter = pgAdmin.Browser.Events.on('pgadmin:object-explorer:filter:apply', (hasFilters) => {
      setHasFilters(hasFilters);
    });

    checkToolbarState();
    return () => {
      deregister();
      deregisterMenu();
      deregisterFilter();
    };
  }, []);


  const handleERDTool = () => {
    const t = pgAdmin.Browser.tree;
    const i = t?.selected();
    ERDModule.getInstance().showErdTool(undefined, i);
  };

  const handleViewAll = () => {
    const t = pgAdmin.Browser.tree;
    const i = t?.selected();
    // mnuid: 3 is standard for "All Rows" in SQLEditorModule
    SQLEditor.getInstance().showViewData({ mnuid: 3 }, i);
  };

  const handleViewFiltered = () => {
    const t = pgAdmin.Browser.tree;
    const i = t?.selected();
    // mnuid: 4 is standard for "Filtered Rows" in SQLEditorModule
    SQLEditor.getInstance().showViewData({ mnuid: 4 }, i);
  };

  const handleGenericClick = (menuItem) => {
    if (!menuItem) return;
    const t = pgAdmin.Browser.tree;
    const i = t?.selected();

    if (typeof menuItem.callback === 'function') {
      menuItem.callback(menuItem.data, i);
    } else if (typeof menuItem.callback === 'string') {
      if (menuItem.module && typeof menuItem.module[menuItem.callback] === 'function') {
        menuItem.module[menuItem.callback](menuItem.data, i);
      } else if (pgAdmin.Browser.Node.callbacks[menuItem.callback]) {
        pgAdmin.Browser.Node.callbacks[menuItem.callback](menuItem.data, i);
      }
    }
  };

  return (
    <Box display="flex" alignItems="center" gap="2px">
      <PgButtonGroup size="small">

        <MacrosToolbarButton
          disabled={disabledState.query_tool}
          shortcut={browserPref?.sub_menu_macros} // Passing support for a future preference
        />
        <ToolbarButton
          icon={
            <Badge badgeContent=" " overlap="circular" variant='dot' color="success" invisible={!hasFilters}>
              <FilterAltRoundedIcon />
            </Badge>
          }
          label={gettext('Filter Objects')}
          isDisabled={false}
          onClick={() => pgAdmin.Browser.Events.trigger('pgadmin:object-explorer:filter:show')}
          id="filter-objects"
        />

        <ToolbarButton
          icon={<ERDIcon />}
          label={gettext('ERD Tool')}
          isDisabled={disabledState.erd}
          onClick={handleERDTool}
        />

        <ToolbarButton
          icon={<ViewDataIcon />}
          label={gettext('All Rows')}
          isDisabled={disabledState.view_all}
          onClick={handleViewAll}
          shortcut={browserPref?.sub_menu_view_data}
        />

        <ToolbarButton
          icon={<RowFilterIcon />}
          label={gettext('Filtered Rows...')}
          isDisabled={disabledState.view_filtered}
          onClick={handleViewFiltered}
        />

        <ToolbarButton
          icon={<SearchOutlinedIcon style={{ height: '1.4rem' }} />}
          label={gettext('Search Objects')}
          isDisabled={disabledState.search_objects}
          onClick={() => handleGenericClick(menus.search_objects)}
          shortcut={browserPref?.sub_menu_search_objects}
        />

        {!_.isUndefined(menus.psql) && (
          <ToolbarButton
            icon={<TerminalRoundedIcon style={{ height: '1.4rem' }} />}
            label={gettext('PSQL Tool')}
            isDisabled={disabledState.psql}
            onClick={() => handleGenericClick(menus.psql)}
          />
        )}
      </PgButtonGroup>
    </Box>
  );
}
