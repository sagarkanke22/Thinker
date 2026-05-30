// Text widget — renders a string with optional style.
//
// Expected config shape (from /render):
//   {
//     type: "text",
//     props: { style?, ...other },
//     children?: string,
//     style?: object,         // logic-level override
//     error?: { type, message }
//   }
//
// Style precedence: base defaults → props.style → top-level style.

const BASE_STYLE = {
  fontFamily: 'system-ui, sans-serif',
  margin: '8px 0',
}

export function Text({ config }) {
  if (config && config.error) {
    return (
      <div
        style={{
          color: 'crimson',
          fontFamily: 'system-ui, sans-serif',
          margin: '8px 0',
          padding: '6px 10px',
          border: '1px solid #fbb',
          borderRadius: 4,
          background: '#fff0f0',
        }}
      >
        Text error: {config.error.message || JSON.stringify(config.error)}
      </div>
    )
  }

  const style = {
    ...BASE_STYLE,
    ...((config && config.props && config.props.style) || {}),
    ...((config && config.style) || {}),
  }

  return <div style={style}>{(config && config.children) ?? ''}</div>
}
