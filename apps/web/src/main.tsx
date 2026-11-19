import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './style.css';
import './resume/resume.css';
import './search/search.css';
import './tailor/tailor.css';
import './apply/apply.css';

const root = document.getElementById('root');
if (!root) throw new Error('ROOT_ELEMENT_MISSING');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);

