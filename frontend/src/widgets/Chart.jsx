// Chart widget — renders any Plotly figure dict returned by the widget's
// logic_code.
//
// Expected config shape (from /render):
//   {
//     type: "chart",
//     props: { layout?: object, title?: string },
//     data:  Array<Plotly trace>,
//     error?: { type, message }
//   }
//
// Uses the react-plotly.js factory + plotly.js-dist-min to avoid pulling
// the full ~7MB plotly.js bundle. dist-min is ~3MB and covers all the
// common chart types we need (bar, scatter, line, pie).

import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

const Plot = createPlotlyComponent(Plotly)

const ERROR_STYLE = {
  color: 'crimson',
  margin: '8px 0',
  padding: '6px 10px',
  border: '1px solid #fbb',
  borderRadius: 4,
  background: '#fff0f0',
  fontFamily: 'system-ui, sans-serif',
}

const WRAP_STYLE = {
  margin: '8px 0',
  background: '#fff',
  borderRadius: 4,
  border: '1px solid #eee',
  padding: 8,
}

const DEFAULT_LAYOUT = {
  autosize: true,
  margin: { l: 60, r: 20, t: 40, b: 60 },
}

const PLOT_CONFIG = {
  displayModeBar: false,
  responsive: true,
}

export function Chart({ config }) {
  if (config && config.error) {
    return (
      <div style={ERROR_STYLE}>
        Chart error: {config.error.message || JSON.stringify(config.error)}
      </div>
    )
  }

  const props = (config && config.props) || {}
  const plotData = Array.isArray(config && config.data) ? config.data : []
  const layout = { ...DEFAULT_LAYOUT, ...(props.layout || {}) }

  if (plotData.length === 0) {
    return (
      <div
        style={{
          ...WRAP_STYLE,
          fontFamily: 'system-ui, sans-serif',
          color: '#999',
          textAlign: 'center',
          padding: 24,
        }}
      >
        No chart data
      </div>
    )
  }

  return (
    <div style={WRAP_STYLE}>
      <Plot
        data={plotData}
        layout={layout}
        useResizeHandler
        style={{ width: '100%', height: 400 }}
        config={PLOT_CONFIG}
      />
    </div>
  )
}
