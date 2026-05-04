////////////////////////////////////////////////////////////
//
// PowerDia — Custom Hierarchy Nodes
//
// Defines three node types for the network hierarchy viewer:
//   SubstationNode  → Level 1 (root)
//   FeederNode      → Level 2 (mid)
//   TransformerNode → Level 3 (leaf)
//
////////////////////////////////////////////////////////////

import {
  DefaultNodeModel,
  DiagramEngine,
  PortWidget,
} from '@projectstorm/react-diagrams';
// NOTE: PortModelAlignment intentionally NOT imported (unused — fix #1)
import { AbstractReactFactory } from '@projectstorm/react-canvas-core';
import PropTypes from 'prop-types';

// ─── Shared colour palette ────────────────────────────────────────────────────
const COLORS = {
  substation:  { bg: '#1565C0', border: '#0D47A1', text: '#FFFFFF' },
  feeder:      { bg: '#2E7D32', border: '#1B5E20', text: '#FFFFFF' },
  transformer: { bg: '#F57F17', border: '#E65100', text: '#FFFFFF' },
};

// ─── Generic Widget ───────────────────────────────────────────────────────────
function PowerDiaWidget({ node, engine, typeKey }) {
  const color = COLORS[typeKey];
  const label = node.getOptions().powerDiaLabel || typeKey;

  return (
    <div style={{
      background: color.bg,
      border: `2px solid ${color.border}`,
      borderRadius: '8px',
      padding: '10px 16px',
      minWidth: '160px',
      color: color.text,
      fontFamily: 'Inter, sans-serif',
      fontSize: '13px',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      cursor: 'grab',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      {/* Left input port */}
      <PortWidget engine={engine} port={node.getPort('left')} style={{ marginRight: 4 }} />
      <span style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {/* Right output port */}
      <PortWidget engine={engine} port={node.getPort('right')} style={{ marginLeft: 4 }} />
    </div>
  );
}

PowerDiaWidget.propTypes = {
  node:    PropTypes.object.isRequired,
  engine:  PropTypes.instanceOf(DiagramEngine).isRequired,
  typeKey: PropTypes.oneOf(['substation', 'feeder', 'transformer']).isRequired,
};

// ─── Models ───────────────────────────────────────────────────────────────────

class PowerDiaBaseNodeModel extends DefaultNodeModel {
  getLinks() {
    let links = {};
    Object.values(this.getPorts()).forEach((port) => {
      links = {
        ...links,
        ...port.getLinks(),
      };
    });
    return links;
  }
}

export class SubstationNodeModel extends PowerDiaBaseNodeModel {
  constructor(options = {}) {
    super({ ...options, type: 'substation' });
    this.addInPort('left');
    this.addOutPort('right');
  }
}

export class FeederNodeModel extends PowerDiaBaseNodeModel {
  constructor(options = {}) {
    super({ ...options, type: 'feeder' });
    this.addInPort('left');
    this.addOutPort('right');
  }
}

export class TransformerNodeModel extends PowerDiaBaseNodeModel {
  constructor(options = {}) {
    super({ ...options, type: 'transformer' });
    this.addInPort('left');
    this.addOutPort('right');
  }
}

// ─── Factories ────────────────────────────────────────────────────────────────
export class SubstationNodeFactory extends AbstractReactFactory {
  constructor() { super('substation'); }
  generateModel(event) {
    return new SubstationNodeModel({ powerDiaLabel: event?.initialConfig?.powerDiaLabel || 'Substation' });
  }
  generateReactWidget(event) {
    return <PowerDiaWidget node={event.model} engine={this.engine} typeKey="substation" />;
  }
}

export class FeederNodeFactory extends AbstractReactFactory {
  constructor() { super('feeder'); }
  generateModel(event) {
    return new FeederNodeModel({ powerDiaLabel: event?.initialConfig?.powerDiaLabel || 'Feeder' });
  }
  generateReactWidget(event) {
    return <PowerDiaWidget node={event.model} engine={this.engine} typeKey="feeder" />;
  }
}

export class TransformerNodeFactory extends AbstractReactFactory {
  constructor() { super('transformer'); }
  generateModel(event) {
    return new TransformerNodeModel({ powerDiaLabel: event?.initialConfig?.powerDiaLabel || 'Transformer' });
  }
  generateReactWidget(event) {
    return <PowerDiaWidget node={event.model} engine={this.engine} typeKey="transformer" />;
  }
}
