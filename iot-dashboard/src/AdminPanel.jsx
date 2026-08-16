import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Trash2, ShieldAlert, CheckCircle2, Loader2 } from 'lucide-react';

// Admin-only screen for managing which users can view which sensors.
// Client-side admin gating is UX only — the real enforcement must live in
// Supabase RLS policies on `device_permissions` (see README "Admin Access").
export default function AdminPanel({ supabase }) {
  const [permissions, setPermissions] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [targetUserId, setTargetUserId] = useState('');
  const [sensorIndex, setSensorIndex] = useState('');
  const [isGranting, setIsGranting] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', text: string }

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
    }
    setIsLoadingList(false);
  }, [supabase]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  // Grant a user access to a specific sensor.
  const grantDeviceAccess = async (targetUserId, sensorIndex) => {
    const { error } = await supabase
      .from('device_permissions')
      .insert([{ user_id: targetUserId, sensor_index: sensorIndex }]);

    if (error) {
      console.error('Failed to grant access:', error.message);
      throw error;
    }
  };

  const handleGrant = async (e) => {
    e.preventDefault();
    setFeedback(null);

    const trimmedUserId = targetUserId.trim();
    const parsedSensorIndex = Number(sensorIndex);

    if (!trimmedUserId) {
      setFeedback({ type: 'error', text: 'User ID is required.' });
      return;
    }
    if (sensorIndex === '' || !Number.isInteger(parsedSensorIndex) || parsedSensorIndex < 0) {
      setFeedback({ type: 'error', text: 'Sensor index must be a non-negative whole number.' });
      return;
    }

    setIsGranting(true);
    try {
      await grantDeviceAccess(trimmedUserId, parsedSensorIndex);
      setFeedback({ type: 'success', text: `Access to sensor ${parsedSensorIndex} granted.` });
      setTargetUserId('');
      setSensorIndex('');
      await fetchPermissions();
    } catch (error) {
      setFeedback({ type: 'error', text: `Failed to grant access: ${error.message}` });
    } finally {
      setIsGranting(false);
    }
  };

  const handleRevoke = async (id) => {
    setRevokingId(id);
    setFeedback(null);
    const { error } = await supabase
      .from('device_permissions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to revoke access:', error.message);
      setFeedback({ type: 'error', text: `Failed to revoke access: ${error.message}` });
    } else {
      setPermissions((prev) => prev.filter((p) => p.id !== id));
    }
    setRevokingId(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Device Access</h1>
        <p className="text-sm text-slate-500 mt-1">Grant or revoke user access to individual sensors.</p>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
          {feedback.text}
        </div>
      )}

      {/* Grant Form */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="font-semibold text-slate-900 mb-4">Grant Access</h3>
        <form onSubmit={handleGrant} className="flex flex-col sm:flex-row gap-4 sm:items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">User ID</label>
            <input
              type="text"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              placeholder="e.g. 3f1b2c4d-..."
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all font-mono text-sm"
              required
            />
          </div>
          <div className="sm:w-40">
            <label className="block text-sm font-medium text-slate-700 mb-1">Sensor Index</label>
            <input
              type="number"
              min="0"
              value={sensorIndex}
              onChange={(e) => setSensorIndex(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isGranting}
            className="flex items-center justify-center gap-2 bg-slate-900 text-white font-semibold py-2.5 px-5 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGranting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Grant
          </button>
        </form>
      </div>

      {/* Existing Permissions */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h3 className="font-semibold text-slate-900 mb-4">Current Permissions</h3>
        {isLoadingList ? (
          <div className="text-sm text-slate-500">Loading...</div>
        ) : permissions.length === 0 ? (
          <div className="text-sm text-slate-500">No permissions have been granted yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="pb-2 font-medium">User ID</th>
                  <th className="pb-2 font-medium">Sensor</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={permission.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 font-mono text-slate-700">{permission.user_id}</td>
                    <td className="py-2.5 text-slate-700">Sensor {permission.sensor_index}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => handleRevoke(permission.id)}
                        disabled={revokingId === permission.id}
                        className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                        title="Revoke access"
                      >
                        {revokingId === permission.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
