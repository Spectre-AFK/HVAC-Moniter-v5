import React, { useState, useEffect, useCallback } from 'react';
import { BellRing, Loader2, CheckCircle2, ShieldAlert } from 'lucide-react';

// Lets any signed-in user set high/low °F thresholds per sensor they can see. A Cloudflare
// Worker cron job (see worker/index.js) checks these every few minutes and emails the owner
// when a threshold is crossed, then again when the reading returns to normal.
export default function AlertSettings({ supabase, sensors, userId }) {
  const [rules, setRules] = useState({}); // sensorKey -> saved row from Supabase
  const [drafts, setDrafts] = useState({}); // sensorKey -> { high, low, enabled } as edited
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', text: string }

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('alert_rules').select('*').eq('user_id', userId);

    if (error) {
      console.error('Failed to load alert rules:', error.message);
      setFeedback({ type: 'error', text: `Failed to load alerts: ${error.message}` });
    } else {
      const ruleMap = {};
      const draftMap = {};
      for (const row of data || []) {
        const key = `${row.device_id}_${row.sensor_index}`;
        ruleMap[key] = row;
        draftMap[key] = { high: row.high_f ?? '', low: row.low_f ?? '', enabled: row.enabled };
      }
      setRules(ruleMap);
      setDrafts(draftMap);
    }
    setIsLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const draftFor = (key) => drafts[key] ?? { high: '', low: '', enabled: true };

  const updateDraft = (key, patch) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...draftFor(key), ...patch } }));
  };

  const handleSave = async (sensor) => {
    const key = sensor.key;
    const draft = draftFor(key);
    const high = draft.high === '' ? null : Number(draft.high);
    const low = draft.low === '' ? null : Number(draft.low);

    setFeedback(null);
    if (high === null && low === null) {
      setFeedback({ type: 'error', text: 'Set at least one threshold (high or low).' });
      return;
    }
    if ((high !== null && Number.isNaN(high)) || (low !== null && Number.isNaN(low))) {
      setFeedback({ type: 'error', text: 'Thresholds must be numbers.' });
      return;
    }

    setSavingKey(key);
    try {
      const { data, error } = await supabase
        .from('alert_rules')
        .upsert(
          {
            id: rules[key]?.id,
            user_id: userId,
            device_id: sensor.deviceId,
            sensor_index: sensor.sensorIndex,
            high_f: high,
            low_f: low,
            enabled: draft.enabled,
          },
          { onConflict: 'user_id,device_id,sensor_index' }
        )
        .select()
        .single();

      if (error) throw error;
      setRules((prev) => ({ ...prev, [key]: data }));
      setFeedback({ type: 'success', text: `Alert saved for ${sensor.label}.` });
    } catch (error) {
      setFeedback({ type: 'error', text: `Failed to save alert: ${error.message}` });
    } finally {
      setSavingKey(null);
    }
  };

  const handleDelete = async (sensor) => {
    const key = sensor.key;
    const existing = rules[key];
    if (!existing) return;

    setSavingKey(key);
    setFeedback(null);
    const { error } = await supabase.from('alert_rules').delete().eq('id', existing.id);
    if (error) {
      setFeedback({ type: 'error', text: `Failed to remove alert: ${error.message}` });
    } else {
      setRules((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      updateDraft(key, { high: '', low: '', enabled: true });
      setFeedback({ type: 'success', text: `Alert removed for ${sensor.label}.` });
    }
    setSavingKey(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <BellRing className="w-6 h-6 text-amber-500" />
          Sensor Alerts
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Get an email when a sensor's temperature goes above or below a threshold you set (checked every few minutes).
        </p>
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

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading...</div>
        ) : sensors.length === 0 ? (
          <div className="p-6 text-sm text-slate-500 dark:text-slate-400">No sensors have reported data yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="p-4 font-medium">Sensor</th>
                  <th className="p-4 font-medium">Low °F</th>
                  <th className="p-4 font-medium">High °F</th>
                  <th className="p-4 font-medium">Enabled</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sensors.map((sensor) => {
                  const draft = draftFor(sensor.key);
                  const hasRule = Boolean(rules[sensor.key]);
                  return (
                    <tr key={sensor.key} className="border-b border-slate-50 dark:border-slate-800 last:border-0">
                      <td className="p-4 text-slate-700 dark:text-slate-300">{sensor.label}</td>
                      <td className="p-4">
                        <input
                          type="number"
                          value={draft.low}
                          onChange={(e) => updateDraft(sensor.key, { low: e.target.value })}
                          placeholder="none"
                          className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </td>
                      <td className="p-4">
                        <input
                          type="number"
                          value={draft.high}
                          onChange={(e) => updateDraft(sensor.key, { high: e.target.value })}
                          placeholder="none"
                          className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </td>
                      <td className="p-4">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={(e) => updateDraft(sensor.key, { enabled: e.target.checked })}
                          className="w-4 h-4 accent-amber-500"
                        />
                      </td>
                      <td className="p-4 text-right whitespace-nowrap space-x-3">
                        <button
                          onClick={() => handleSave(sensor)}
                          disabled={savingKey === sensor.key}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-amber-400 hover:opacity-80 disabled:opacity-50"
                        >
                          {savingKey === sensor.key ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                        </button>
                        {hasRule && (
                          <button
                            onClick={() => handleDelete(sensor)}
                            disabled={savingKey === sensor.key}
                            className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
