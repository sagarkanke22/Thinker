// Widget type registry — maps a widget `type` (from base_config.type) to
// the React component that renders it.
//
// Step 8 wires every type to Placeholder. Steps 9-13 register the real
// implementations (Text, Input, Button, Table, Chart) by calling
// registerWidget(type, Component).

import { Placeholder } from './Placeholder.jsx'
import { Text } from './Text.jsx'
import { Input } from './Input.jsx'
import { Button } from './Button.jsx'
import { Table } from './Table.jsx'
import { Chart } from './Chart.jsx'

const REGISTRY = {
  text: Text,
  input: Input,
  button: Button,
  table: Table,
  chart: Chart,
}

export function getWidgetComponent(type) {
  return REGISTRY[type] || Placeholder
}

export function registerWidget(type, component) {
  REGISTRY[type] = component
}
