import { useEffect, useMemo, useState } from "react";
import { login, me, register, setToken, getToken } from "./api";

function Field({ label, ...props }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>{label}</div>
      <input
        {...props}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(0,0,0,0.15)",
          outline: "none",
        }}
      />
    </label>
  );
}

function Button({ children, ...props }) {
  return (
    <button
      {...props}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.15)",
        background: "white",
        cursor: "pointer",
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [token, setTokenState] = useState(() => getToken());
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const title = useMemo(
    () => (mode === "login" ? "Sign in" : "Request access"),
    [mode]
  );

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    let canceled = false;
    (async () => {
      try {
        const u = await me();
        if (!canceled) setUser(u);
      } catch {
        setToken(null);
        setTokenState(null);
        if (!canceled) setUser(null);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const fn = mode === "login" ? login : register;
      const { token: t } = await fn(email.trim(), password);
      setToken(t);
      setTokenState(t);
      const u = await me();
      setUser(u);
    } catch (e2) {
      setErr(e2?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setToken(null);
    setTokenState(null);
    setUser(null);
    setEmail("");
    setPassword("");
    setErr("");
    setMode("login");
  }

  if (user) {
    return (
      <div style={{ maxWidth: 720, margin: "40px auto", padding: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0 }}>Contextboard</h2>
          <Button onClick={logout}>Log out</Button>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 16,
            borderRadius: 14,
            border: "1px solid rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.8 }}>Signed in as</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
            {user.email}
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            User ID: {user.id}
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 16,
            borderRadius: 14,
            border: "1px dashed rgba(0,0,0,0.2)",
          }}
        >
          Next: we’ll add board create/save/load here (private per account).
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 20 }}>
      <h2 style={{ marginBottom: 8 }}>{title}</h2>
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 18 }}>
        {mode === "register"
          ? "Invite-only: your email must be on the allowlist."
          : "Sign in to access your private boards."}
      </div>

      <form onSubmit={handleSubmit}>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          required
        />

        {err ? (
          <div style={{ marginBottom: 12, color: "crimson", fontSize: 13 }}>
            {err}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Button type="submit" disabled={busy}>
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Register"}
          </Button>

          <button
            type="button"
            onClick={() => {
              setErr("");
              setMode(mode === "login" ? "register" : "login");
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "royalblue",
              cursor: "pointer",
              padding: 0,
            }}
            disabled={busy}
          >
            {mode === "login" ? "Need an invite?" : "Already invited? Sign in"}
          </button>
        </div>
      </form>

      <div style={{ marginTop: 22, fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>
        Tip: if you see “Not invited”, add your email to the API service env var{" "}
        <code>INVITE_ALLOWLIST</code> on Render and redeploy.
      </div>
    </div>
  );
}
