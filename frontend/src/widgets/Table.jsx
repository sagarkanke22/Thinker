// Table widget — renders columns header + rows from config.data.
//
// Expected config shape (from /render):
//   {
//     type: "table",
//     props: {
//       columns: Array<string | {field: string, header?: string}>,
//       footer?: string,
//     },
//     data:  Array<{ [field]: any, _style?: object }>,
//     error?: { type, message }
//   }
//
// Columns accept either:
//   - plain strings (legacy; field name doubles as header)
//   - {field, header} objects (matches agents.py FRONTEND_CAPABILITIES contract)
//
// Per-row optional `_style` applies to every <td> in that row — handy
// for "this row is in deficit" or "this row is highlighted" patterns
// without committing to a per-cell styling system yet.

const WRAP_STYLE = { margin: '8px 0', overflowX: 'auto' }
const TABLE_STYLE = {
  borderCollapse: 'collapse',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  width: '100%',
  background: '#fff',
}
const TH_STYLE = {
  background: '#f4f4f8',
  padding: '6px 10px',
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
  fontWeight: 600,
  fontSize: 12,
  color: '#444',
}
const TD_STYLE = {
  padding: '5px 10px',
  borderBottom: '1px solid #eee',
}
const FOOTER_STYLE = {
  fontSize: 12,
  color: '#666',
  margin: '4px 2px 0',
  fontFamily: 'system-ui, sans-serif',
}
const EMPTY_STYLE = {
  ...TD_STYLE,
  color: '#999',
  fontStyle: 'italic',
  textAlign: 'center',
}

function formatCell(v) {
  if (v == null) return ''
  if (typeof v === 'number') return v.toLocaleString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function Table({ config }) {
  if (config && config.error) {
    return (
      <div
        style={{
          color: 'crimson',
          margin: '8px 0',
          padding: '6px 10px',
          border: '1px solid #fbb',
          borderRadius: 4,
          background: '#fff0f0',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        Table error: {config.error.message || JSON.stringify(config.error)}
      </div>
    )
  }

  const props = (config && config.props) || {}
  const rawColumns = Array.isArray(props.columns) ? props.columns : []
  const data = Array.isArray(config && config.data) ? config.data : []
  const footer = props.footer

  // Normalize columns: accept either ["plain", "string", "names"] or
  // [{field, header}, ...]. Internally we always work with {field, header}.
  // Mismatch between the {field, header} contract (advertised in
  // agents.py FRONTEND_CAPABILITIES) and the legacy string-only renderer
  // was causing a blank screen because React got an object as a key.
  const columns = rawColumns
    .map((c) =>
      typeof c === 'string'
        ? { field: c, header: c }
        : c && typeof c === 'object' && c.field
        ? { field: c.field, header: c.header || c.field }
        : null,
    )
    .filter(Boolean)

  if (columns.length === 0) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', color: '#888', margin: '8px 0' }}>
        Table has no columns defined
      </div>
    )
  }

  return (
    <div style={WRAP_STYLE}>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.field} style={TH_STYLE}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={EMPTY_STYLE}>
                No rows
              </td>
            </tr>
          ) : (
            data.map((row, i) => {
              const rowStyle = (row && row._style) || {}
              return (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.field} style={{ ...TD_STYLE, ...rowStyle }}>
                      {formatCell(row && row[col.field])}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
      {footer && <div style={FOOTER_STYLE}>{footer}</div>}
    </div>
  )
}
