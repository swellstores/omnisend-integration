import InitialSync from './InitialSync';
import './App.css';

export default function App() {
  return <main>
    <h1>Omnisend initial sync</h1>
    <p>Send existing contacts, products and orders to Omnisend page by page: all of them, or only those created on or after a date you choose. New changes sync automatically once Enable Integration is on. Keep this page open until each sync completes.</p>
    <InitialSync />
  </main>;
}
