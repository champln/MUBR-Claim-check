import React from 'react';
import ReactDOM from 'react-dom/client';
import MbrAuditCenter from './MbrAuditCenter.jsx';
import './index.css';

// Entry point แยกสำหรับ "MBR Audit Center" (หน้าทดลองใช้งานแบบ standalone)
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MbrAuditCenter />
  </React.StrictMode>
);
