/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import { PgIconButton } from '../../../../static/js/components/Buttons';
import PropTypes from 'prop-types';
import { styled } from '@mui/material/styles';
import { WORKSPACES } from '../../../../browser/static/js/constants';
import { useWorkspace } from './WorkspaceProvider';
import { LAYOUT_EVENTS } from '../../../../static/js/helpers/Layout';
import gettext from 'sources/gettext';
import withCheckPermission from '../../../../browser/static/js/withCheckPermission';
import Preferences from '../../../../preferences/static/js/preferences';

const StyledWorkspaceButton = styled(PgIconButton)(({theme}) => ({
  '&.Buttons-iconButtonDefault': {
    border: 'none',
    borderRight: '2px solid transparent' ,
    borderRadius: 0,
    padding: '8px 6px',
    height: '40px',
    backgroundColor: theme.palette.background.default,
    '&:hover': {
      borderColor: 'transparent',
    },
    '&.active': {
      backgroundColor: theme.otherVars.tree.bgSelected,
      borderRightColor: theme.palette.primary.main,
    },
    '&.Mui-disabled': {
      backgroundColor: theme.palette.background.default,
      borderRightColor: 'transparent',
    }
  },
}));

function WorkspaceButton({ menuItem, value, options, ...props }) {
  const { currentWorkspace, hasOpenTabs, getLayoutObj, onWorkspaceDisabled, changeWorkspace } = useWorkspace();
  const active = value == currentWorkspace;
  const [disabled, setDisabled] = useState();

  useEffect(() => {
    const layout = getLayoutObj(value);
    const deregInit = layout.eventBus.registerListener(LAYOUT_EVENTS.INIT, () => {
      setDisabled(!hasOpenTabs(value));
    });
    const deregChange = layout.eventBus.registerListener(LAYOUT_EVENTS.CHANGE, () => {
      setDisabled(!hasOpenTabs(value));
    });
    const deregRemove = layout.eventBus.registerListener(LAYOUT_EVENTS.REMOVE, () => {
      setDisabled(!hasOpenTabs(value));
    });

    return () => {
      deregInit();
      deregChange();
      deregRemove();
    };
  }, []);

  useEffect(() => {
    if (disabled && active) {
      onWorkspaceDisabled();
    }
  }, [disabled]);

  return (
    <StyledWorkspaceButton className={active ? 'active' : ''} title={menuItem?.label ?? ''}
      {...props}
      onClick={() => {
        if (props.onClick) {
          props.onClick();
        } else if (menuItem) {
          menuItem?.callback();
        } else {
          // Check permission and call.
          withCheckPermission(options, () => {
            changeWorkspace(value);
          })();
        }
      }}
      disabled={disabled}
    />
  );
}
WorkspaceButton.propTypes = {
  menuItem: PropTypes.object,
  active: PropTypes.bool,
  changeWorkspace: PropTypes.func,
  value: PropTypes.string,
  options: PropTypes.object,
  onClick: PropTypes.func,
};

const Root = styled('div')(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  ...theme.mixins.panelBorder.top,
  ...theme.mixins.panelBorder.right,
}));

export default function WorkspaceToolbar() {

  return (
    <Root>
      <WorkspaceButton icon={<AccountTreeRoundedIcon />} value={WORKSPACES.DEFAULT} title={gettext('Default Workspace')} tooltipPlacement="right" />
      <Box marginTop="auto">
        <WorkspaceButton icon={<SettingsIcon />} onClick={() => {
          Preferences.getInstance().show();
        }} title={gettext('Preferences')} tooltipPlacement="right" />
      </Box>
    </Root>
  );
}

