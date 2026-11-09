import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/orbitron/latin-500.css'
import '@fontsource/orbitron/latin-700.css'
import '@fontsource/rajdhani/latin-500.css'
import '@fontsource/rajdhani/latin-600.css'
import '@fontsource/rajdhani/latin-700.css'
import '@fontsource/noto-sans-bengali/bengali-400.css'
import '@fontsource/noto-sans-bengali/bengali-600.css'
import './styles.css'
import App from './App'
import { Component } from 'react'

class Boundary extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div style={{ padding: 24, color: '#ffc247', fontFamily: 'Rajdhani, sans-serif' }}>
        <h2>Astra Vigil 2.0 hit an error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#d3ecf6' }}>{String(this.state.err?.message || this.state.err)}</pre>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
)
