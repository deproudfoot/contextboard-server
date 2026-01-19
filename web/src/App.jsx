import { useEffect, useState } from "react";

export default function App() {
  const [health, setHealth] = useState(null);
  const apiBase = import.meta.env.VITE_API_BASE;

  useEffect(() => {
    fetch(`${apiBase}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setHealth({ ok: false, error: String(e) }));
  }, [apiBase]);

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Contextboard Web</h1>
      <p>API Base: {apiBase}</p>
      <pre>{JSON.stringify(health, null, 2)}</pre>
    </div>
  );
}
