import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './application';
import { client } from './query-client';
import './styles.css';
const root = document.getElementById('root');
if (!root) {
    throw new Error('Root element missing');
}
ReactDOM.createRoot(root).render(
    <React.StrictMode>
        <QueryClientProvider client={client}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </QueryClientProvider>
    </React.StrictMode>
);
