import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './AlignmentApp.jsx'
import AdminApp from './AdminApp.jsx'

const isAdmin = window.location.pathname === '/admin'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isAdmin ? <AdminApp /> : <App />}
  </React.StrictMode>
)
