import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './lib/theme/ThemeProvider';
import { initAccentColor } from './lib/theme/accent-color';
import { installAccountsMock } from './dev/mock-invoke';
import './styles/index.css';

// 启动即恢复自定义主色，避免首屏使用默认色后闪烁。
initAccentColor();

if (import.meta.env.DEV) {
  installAccountsMock();
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
