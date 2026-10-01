import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import "./AdminPanel.css";

const ADMIN_FUNCTION = "admin-api";
const INITIAL_LIMIT = 10;

function formatDateTime(value) {
  if (!value) return "-";

  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function maskDeviceKey(value) {
  if (!value) return "-";
  if (value.length <= 14) return value;
  return `${value.slice(0, 10)}…${value.slice(-4)}`;
}

function StatCard({ label, value, hint }) {
  return (
    <div className="admin-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function AdminLogin({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data, error: loginError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (loginError) {
        throw loginError;
      }

      if (!data.session) {
        throw new Error("Session admin tidak berhasil dibuat.");
      }

      onLoggedIn(data.session);
    } catch (loginError) {
      console.error(loginError);
      setError(
        loginError?.message ||
          "Login admin gagal. Periksa email dan password."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-bg-glow admin-glow-one" />
      <div className="admin-bg-glow admin-glow-two" />

      <div className="admin-login-shell">
        <div className="admin-brand">
          <span className="admin-brand-dot" />
          GONAUDIO ADMIN
        </div>

        <div className="admin-login-card">
          <div className="admin-login-header">
            <strong>ADMIN ACCESS</strong>
            <span>
              Login menggunakan akun admin Supabase yang sudah didaftarkan.
            </span>
          </div>

          <form onSubmit={submit} className="admin-login-form">
            <label>
              <span>EMAIL</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
                autoComplete="username"
                disabled={loading}
                required
              />
            </label>

            <label>
              <span>PASSWORD</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                disabled={loading}
                required
              />
            </label>

            {error ? <div className="admin-feedback error">{error}</div> : null}

            <button type="submit" disabled={loading}>
              {loading ? "CHECKING..." : "LOGIN ADMIN"}
            </button>
          </form>

          <div className="admin-login-footer">
            <a href="#">← Kembali ke GonAUDIO</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ session, onLogout }) {
  const [dailyLimit, setDailyLimit] = useState(INITIAL_LIMIT);
  const [inputLimit, setInputLimit] = useState(String(INITIAL_LIMIT));
  const [stats, setStats] = useState({
    total_devices: 0,
    total_processed: 0,
    devices_at_limit: 0,
    visible_remaining_quota: 0,
  });
  const [usage, setUsage] = useState([]);
  const [today, setToday] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const remainingVisible = useMemo(() => {
    return Number(stats.visible_remaining_quota) || 0;
  }, [stats.visible_remaining_quota]);

  const callAdmin = async (action, extra = {}) => {
    const { data, error: functionError } = await supabase.functions.invoke(
      ADMIN_FUNCTION,
      {
        body: {
          action,
          ...extra,
        },
      }
    );

    if (functionError) {
      throw functionError;
    }

    if (!data) {
      throw new Error("Admin API tidak mengembalikan data.");
    }

    if (!data.success) {
      throw new Error(data.message || "Admin request gagal.");
    }

    return data;
  };

  const loadDashboard = async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const data = await callAdmin("dashboard");
      const limit = Number(data.settings?.daily_limit);

      setDailyLimit(Number.isFinite(limit) ? limit : INITIAL_LIMIT);
      setInputLimit(String(Number.isFinite(limit) ? limit : INITIAL_LIMIT));
      setStats(
        data.stats || {
          total_devices: 0,
          total_processed: 0,
          devices_at_limit: 0,
          visible_remaining_quota: 0,
        }
      );
      setUsage(Array.isArray(data.usage) ? data.usage : []);
      setToday(data.today || "");
      setUpdatedAt(data.settings?.updated_at || "");
    } catch (dashboardError) {
      console.error(dashboardError);
      setError(
        dashboardError?.message ||
          "Gagal memuat dashboard admin."
      );
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveLimit = async (event) => {
    event.preventDefault();
    const value = Number(inputLimit);

    if (!Number.isInteger(value) || value < 0 || value > 1000) {
      setError("Global daily quota harus bilangan bulat 0-1000.");
      setMessage("");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const data = await callAdmin("set_limit", {
        dailyLimit: value,
      });

      const saved = Number(data.settings?.daily_limit) || 0;
      setDailyLimit(saved);
      setInputLimit(String(saved));
      setMessage(`Global daily quota berhasil diubah menjadi ${saved}.`);
      await loadDashboard(true);
    } catch (saveError) {
      console.error(saveError);
      setError(saveError?.message || "Gagal menyimpan quota.");
    } finally {
      setSaving(false);
    }
  };

  const resetToday = async () => {
    const confirmed = window.confirm(
      `Reset quota semua device untuk ${today || "hari ini"}? Tindakan ini menghapus catatan penggunaan hari ini.`
    );

    if (!confirmed) return;

    setResetting(true);
    setError("");
    setMessage("");

    try {
      const data = await callAdmin("reset_today");
      setMessage(data.message || "Quota hari ini berhasil direset.");
      await loadDashboard(true);
    } catch (resetError) {
      console.error(resetError);
      setError(resetError?.message || "Gagal mereset quota hari ini.");
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-page admin-loading-page">
        <div className="admin-loader">LOADING ADMIN DASHBOARD...</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-bg-glow admin-glow-one" />
      <div className="admin-bg-glow admin-glow-two" />

      <main className="admin-container">
        <header className="admin-topbar">
          <div>
            <div className="admin-brand">
              <span className="admin-brand-dot" />
              GONAUDIO ADMIN
            </div>
            <small>
              {session?.user?.email || "Admin"}
              {today ? ` • ${today} WIB` : ""}
            </small>
          </div>

          <div className="admin-top-actions">
            <a href="#" className="admin-secondary-button">
              ← PUBLIC SITE
            </a>
            <button
              type="button"
              className="admin-danger-button"
              onClick={onLogout}
            >
              LOGOUT
            </button>
          </div>
        </header>

        {error ? <div className="admin-feedback error">{error}</div> : null}
        {message ? <div className="admin-feedback success">{message}</div> : null}

        <section className="admin-hero-grid">
          <div className="admin-quota-card">
            <div className="admin-card-heading">
              <span>GLOBAL DAILY QUOTA</span>
              <small>APPLIES TO ALL DEVICES</small>
            </div>

            <form onSubmit={saveLimit} className="admin-quota-form">
              <div className="admin-quota-input-wrap">
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="1"
                  value={inputLimit}
                  onChange={(event) => setInputLimit(event.target.value)}
                  disabled={saving}
                />
                <span>PROCESS / DEVICE / DAY</span>
              </div>

              <button type="submit" disabled={saving}>
                {saving ? "SAVING..." : "SAVE QUOTA"}
              </button>
            </form>

            <div className="admin-quota-meta">
              <span>Current: <strong>{dailyLimit}</strong></span>
              <span>Last update: {formatDateTime(updatedAt)}</span>
            </div>
          </div>

          <div className="admin-action-card">
            <div className="admin-card-heading">
              <span>QUICK ACTIONS</span>
              <small>SERVER-SIDE</small>
            </div>

            <button
              type="button"
              className="admin-reset-button"
              onClick={resetToday}
              disabled={resetting}
            >
              {resetting ? "RESETTING..." : "RESET ALL DEVICES TODAY"}
            </button>

            <button
              type="button"
              className="admin-refresh-button"
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
            >
              {refreshing ? "REFRESHING..." : "REFRESH DATA"}
            </button>
          </div>
        </section>

        <section className="admin-stats-grid">
          <StatCard
            label="DEVICES TODAY"
            value={stats.total_devices}
            hint="devices with usage"
          />
          <StatCard
            label="PROCESSING TODAY"
            value={stats.total_processed}
            hint="successful quota consumes"
          />
          <StatCard
            label="AT DAILY LIMIT"
            value={stats.devices_at_limit}
            hint="devices reaching the cap"
          />
          <StatCard
            label="VISIBLE REMAINING"
            value={remainingVisible}
            hint="sum across active devices"
          />
        </section>

        <section className="admin-table-card">
          <div className="admin-table-heading">
            <div>
              <span>DEVICE USAGE</span>
              <small>HASHED DEVICE KEY — TODAY ONLY</small>
            </div>
            <span>{usage.length} rows</span>
          </div>

          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>DEVICE KEY</th>
                  <th>USED</th>
                  <th>REMAINING</th>
                  <th>LAST UPDATE</th>
                </tr>
              </thead>
              <tbody>
                {usage.length ? (
                  usage.map((row, index) => {
                    const used = Number(row.process_count) || 0;
                    const remaining = Math.max(dailyLimit - used, 0);

                    return (
                      <tr key={`${row.device_key}-${row.updated_at}`}>
                        <td>{index + 1}</td>
                        <td>
                          <code title={row.device_key}>
                            {maskDeviceKey(row.device_key)}
                          </code>
                        </td>
                        <td>
                          <strong>{used}</strong>
                        </td>
                        <td>{remaining}</td>
                        <td>{formatDateTime(row.updated_at)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="5" className="admin-empty-cell">
                      Belum ada device yang memakai quota hari ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="admin-footer">
          <span>GONAUDIO</span>
          <span>•</span>
          <span>ADMIN PANEL</span>
          <span>•</span>
          <span>GLOBAL QUOTA CONTROL</span>
        </footer>
      </main>
    </div>
  );
}

export default function AdminPanel() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession || null);
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.hash = "admin";
  };

  if (checkingSession) {
    return (
      <div className="admin-page admin-loading-page">
        <div className="admin-loader">CHECKING ADMIN SESSION...</div>
      </div>
    );
  }

  if (!session) {
    return <AdminLogin onLoggedIn={setSession} />;
  }

  return <AdminDashboard session={session} onLogout={handleLogout} />;
}
