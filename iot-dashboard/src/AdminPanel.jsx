import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UserPlus, Trash2, ShieldAlert, CheckCircle2, Loader2, Search, X } from 'lucide-react';

// Admin-only screen for managing which users can view which sensors.
// Client-side admin gating is UX only — the real enforcement must live in
// Supabase RLS policies on `device_permissions` (see README "Admin Access").
export default function AdminPanel({ supabase, sensors, accessToken }) {
  const [permissions, setPermissions] = useState([]);
  const [userEmails, setUserEmails] = useState({}); // user_id -> email (resolved via /api/admin/users)
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', text: string }

  // Grant form
  const [selectedSensorKey, setSelectedSensorKey] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null); // { id, email }
  const [userResults, setUserResults] = useState([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [isGranting, setIsGranting] = useState(false);

  const [revokingId, setRevokingId] = useState(null);

  const sensorByKey = useMemo(() => new Map(sensors.map((s) => [s.key, s])), [sensors]);

  const labelForPermission = useCallback(
    (permission) => {
      const match = sensorByKey.get(`${permission.device_id}_${permission.sensor_index}`);
      if (match) return match.label;
      const suffix = permission.device_id ? permission.device_id.slice(-4).toUpperCase() : '????';
      return `Sensor ${permission.sensor_index} · Device ${suffix}`;
    },
    [sensorByKey]
  );

  const resolveEmails = useCallback(
    async (userIds) => {
      const missing = [...new Set(userIds)].filter((id) => !(id in userEmails));
      if (missing.length === 0) return;
      try {
        const res = await fetch(`/api/admin/users?ids=${encodeURIComponent(missing.join(','))}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
        const data = await res.json();
        const found = new Map((data.users || []).map((u) => [u.id, u.email]));
        setUserEmails((prev) => {
          const next = { ...prev };
          for (const id of missing) next[id] = found.get(id) ?? null;
          return next;
        });
      } catch (error) {
        console.error('Failed to resolve user emails:', error.message);
      }
    },
    [accessToken, userEmails]
  );

  const fetchPermissions = useCallback(async () => {
    setIsLoadingList(true);
    const { data, error } = await supabase
      .from('device_permissions')
      .select('*');

    if (error) {
      console.error('Failed to load permissions:', error.message);
      setFeedback({ type: 'error', text: `Failed to load permissions: ${error.message}` });
    } else {
      setPermissions(data || []);
      await resolveEmails((data || []).map((p) => p.user_id));
    }
    setIsLoadingList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  // Debounced email search as the admin types in the "Add user" field.
  useEffect(() => {
    if (userQuery.trim().length < 2 || selectedUser?.email === userQuery) {
      setUserResults([]);
      return;
    }
    let cancelled = false;
    setIsSearchingUsers(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/users?query=${encodeURIComponent(userQuery.trim())}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) setUserResults(data.users || []);
      } catch (error) {
        if (!cancelled) console.error('User search failed:', error.message);
      } finally {
        if (!cancelled) setIsSearchingUsers(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userQuery, selectedUser, accessToken]);

  const pickUser = (user) => {
    setSelectedUser(user);
    setUserQuery(user.email || user.id);
    setUserResults([]);
    setUserEmails((prev) => (user.id in prev ? prev : { ...prev, [user.id]: user.email }));
  };

  const clearSelectedUser = () => {
    setSelectedUser(null);
    setUserQuery('');
    setUserResults([]);
  };

  const handleGrant = async (e) => {
    e.preventDefault();
    setFeedback(null);

    const sensor = sensorByKey.get(selectedSensorKey);
    if (!sensor) {
      setFeedback({ type: 'error', text: 'Choose a sensor to grant access to.' });
      return;
    }
    if (!selectedUser) {
      setFeedback({ type: 'error', text: 'Search for and select a user first.' });
      return;
    }

    setIsGranting(true);
    try {
      const { error } = await supabase
        .from('device_permissions')
        .insert([{ user_id: selectedUser.id, device_id: sensor.deviceId, sensor_index: sensor.sensorIndex }]);

      if (error) {
        // Postgres unique_violation — this grant already exists.
        if (error.code === '23505') {
          setFeedback({ type: 'error', text: `${selectedUser.email} already has access to ${sensor.label}.` });
        } else {
          throw error;
        }
        return;
      }

      setFeedback({ type: 'success', text: `Granted ${selectedUser.email} access to ${sensor.label}.` });
      setSelectedSensorKey('');
      clearSelectedUser();
      await fetchPermissions();
    } catch (error) {
      setFeedback({ type: 'error', text: `Failed to grant access: ${error.message}` });
    } finally {
      setIsGranting(false);
    }
  };

  const handleRevoke = async (permission) => {
    const email = userEmails[permission.user_id] || permission.user_id;
    const label = labelForPermission(permission);
    if (!window.confirm(`Revoke ${email}'s access to ${label}?`)) return;

    setRevokingId(permission.id);
    setFeedback(null);
    const { error } = await supabase
      .from('device_permissions')
      .delete()
      .eq('id', permission.id);

    if (error) {
      console.error('Failed to revoke access:', error.message);
      setFeedback({ type: 'error', text: `Failed to revoke access: ${error.message}` });
    } else {
      setPermissions((prev) => prev.filter((p) => p.id !== permission.id));
      setFeedback({ type: 'success', text: `Revoked ${email}'s access to ${label}.` });
    }
    setRevokingId(null);
  };

  // Group flat permission rows by user so an admin can scan "who has access to what" at a glance.
  const groupedByUser = useMemo(() => {
    const groups = new Map();
    for (const permission of permissions) {
      if (!groups.has(permission.user_id)) groups.set(permission.user_id, []);
      groups.get(permission.user_id).push(permission);
    }
    return [...groups.entries()]
      .map(([userId, perms]) => ({
        userId,
        email: userEmails[userId] || userId,
        permissions: perms.sort((a, b) => labelForPermission(a).localeCompare(labelForPermission(b))),
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }, [permissions, userEmails, labelForPermission]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Device Access</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Grant or revoke user access to individual sensors.</p>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900'
              : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900'
          }`}
        >
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
          {feedback.text}
        </div>
      )}

      {/* Grant Form */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4">Grant Access</h3>
        <form onSubmit={handleGrant} className="flex flex-col sm:flex-row gap-4 sm:items-end">
          <div className="flex-1 relative">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">User</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={userQuery}
                onChange={(e) => {
                  setUserQuery(e.target.value);
                  setSelectedUser(null);
                }}
                placeholder="Search by email..."
                className="w-full pl-9 pr-8 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all text-sm"
                autoComplete="off"
              />
              {userQuery && (
                <button
                  type="button"
                  onClick={clearSelectedUser}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  title="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {(isSearchingUsers || userResults.length > 0) && !selectedUser && (
              <div className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {isSearchingUsers ? (
                  <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching...
                  </div>
                ) : (
                  userResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => pickUser(u)}
                      className="block w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      {u.email}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Sensor</label>
            <select
              value={selectedSensorKey}
              onChange={(e) => setSelectedSensorKey(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all text-sm"
            >
              <option value="">Choose a sensor...</option>
              {sensors.map((sensor) => (
                <option key={sensor.key} value={sensor.key}>
                  {sensor.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={isGranting || !selectedUser || !selectedSensorKey}
            className="flex items-center justify-center gap-2 bg-slate-900 text-white font-semibold py-2.5 px-5 rounded-lg hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-900 dark:hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGranting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Grant
          </button>
        </form>
        {sensors.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
            No sensors have reported data yet, so there's nothing to grant access to.
          </p>
        )}
      </div>

      {/* Existing Permissions, grouped by user */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4">Current Permissions</h3>
        {isLoadingList ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">Loading...</div>
        ) : groupedByUser.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">No permissions have been granted yet.</div>
        ) : (
          <div className="space-y-5">
            {groupedByUser.map((group) => (
              <div key={group.userId} className="border border-slate-100 dark:border-slate-800 rounded-xl p-4">
                <div className="font-medium text-slate-900 dark:text-slate-100 text-sm mb-2">{group.email}</div>
                <ul className="divide-y divide-slate-50 dark:divide-slate-800">
                  {group.permissions.map((permission) => (
                    <li key={permission.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-slate-700 dark:text-slate-300">{labelForPermission(permission)}</span>
                      <button
                        onClick={() => handleRevoke(permission)}
                        disabled={revokingId === permission.id}
                        className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
                        title="Revoke access"
                      >
                        {revokingId === permission.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

