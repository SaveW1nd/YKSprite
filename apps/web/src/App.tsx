import React from 'react';
import { fetchStatus } from './lib/api';

const App: React.FC = () => {
  const [status, setStatus] = React.useState('Loading');

  React.useEffect(() => {
    fetchStatus().then(setStatus);
  }, []);

  return (
    <main className="app-shell">
      <h1>YKSprite Control Center</h1>
      <p>Status: {status}</p>
    </main>
  );
};

export default App;
