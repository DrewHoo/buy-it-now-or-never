import React from 'react'
import ReactDOM from 'react-dom/client'
import './analytics.js' // side-effect: starts the lazy Mixpanel load
import App from './App.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
