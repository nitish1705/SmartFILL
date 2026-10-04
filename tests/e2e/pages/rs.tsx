import React from 'react';
import { createRoot } from 'react-dom/client';
import Select from 'react-select';

const options = [
  { value: 'US', label: 'United States' },
  { value: 'IN', label: 'India' },
  { value: 'DE', label: 'Germany' },
];

createRoot(document.getElementById('root')!).render(
  <form>
    <label htmlFor="country">Country</label>
    <Select inputId="country" options={options} placeholder="Select..." />
  </form>,
);
