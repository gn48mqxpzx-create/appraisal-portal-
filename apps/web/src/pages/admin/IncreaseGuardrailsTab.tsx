import { useState, useEffect, useCallback } from 'react';

interface GuardrailRow {
  id: string;
  levelName: string;
  colorCode: string;
  minPercent: number | null;
  maxPercent: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  actionRequired: string;
  isActive: boolean;
  sortOrder: number;
}

type DraftRow = Omit<GuardrailRow, 'id' | 'createdAt' | 'updatedAt'>;

const emptyDraft = (): DraftRow => ({
  levelName: '',
  colorCode: '#22c55e',
  minPercent: null,
  maxPercent: null,
  minAmount: null,
  maxAmount: null,
  actionRequired: '',
  isActive: true,
  sortOrder: 0,
});

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString();
}

function ColorDot({ hex }: { hex: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: hex,
        border: '1px solid rgba(0,0,0,0.15)',
        flexShrink: 0,
      }}
    />
  );
}

function LevelBadge({ levelName, colorCode }: { levelName: string; colorCode: string }) {
  const bg = colorCode + '22'; // low-opacity fill
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: bg,
        color: colorCode,
        border: `1px solid ${colorCode}55`,
        whiteSpace: 'nowrap',
      }}
    >
      <ColorDot hex={colorCode} />
      {levelName || '—'}
    </span>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  min?: string;
  step?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        min={min}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 10px',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          fontSize: 13,
          color: '#111827',
          background: '#fff',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

interface RowFormProps {
  draft: DraftRow;
  onChange: (patch: Partial<DraftRow>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  title: string;
}

function RowForm({ draft, onChange, onSave, onCancel, saving, title }: RowFormProps) {
  return (
    <div
      style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '20px 24px',
        marginBottom: 20,
      }}
    >
      <h4 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: '#374151' }}>{title}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
        <FieldInput
          label="Level Name"
          value={draft.levelName}
          onChange={(v) => onChange({ levelName: v })}
          placeholder="e.g. Green"
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Color
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              aria-label="Color picker"
              title="Color picker"
              value={draft.colorCode}
              onChange={(e) => onChange({ colorCode: e.target.value })}
              style={{ width: 38, height: 32, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', padding: 2 }}
            />
            <span style={{ fontSize: 13, color: '#6b7280' }}>{draft.colorCode}</span>
          </div>
        </div>
        <FieldInput
          label="Min % (incl.)"
          value={draft.minPercent !== null ? String(draft.minPercent) : ''}
          onChange={(v) => onChange({ minPercent: v.trim() === '' ? null : Number(v) })}
          type="number"
          step="0.01"
          placeholder="0"
        />
        <FieldInput
          label="Max % (incl.)"
          value={draft.maxPercent !== null ? String(draft.maxPercent) : ''}
          onChange={(v) => onChange({ maxPercent: v.trim() === '' ? null : Number(v) })}
          type="number"
          step="0.01"
          placeholder="No upper limit"
        />
        <FieldInput
          label="Min Amount (incl.)"
          value={draft.minAmount !== null ? String(draft.minAmount) : ''}
          onChange={(v) => onChange({ minAmount: v.trim() === '' ? null : Number(v) })}
          type="number"
          step="1"
          placeholder="0"
        />
        <FieldInput
          label="Max Amount (incl.)"
          value={draft.maxAmount !== null ? String(draft.maxAmount) : ''}
          onChange={(v) => onChange({ maxAmount: v.trim() === '' ? null : Number(v) })}
          type="number"
          step="1"
          placeholder="No upper limit"
        />
        <FieldInput
          label="Action Required"
          value={draft.actionRequired}
          onChange={(v) => onChange({ actionRequired: v })}
          placeholder="Standard Review"
        />
        <FieldInput
          label="Sort Order"
          value={String(draft.sortOrder)}
          onChange={(v) => onChange({ sortOrder: Number(v) || 0 })}
          type="number"
          min="0"
          placeholder="0"
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Active
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 6 }}>
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => onChange({ isActive: e.target.checked })}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13, color: '#374151' }}>Active</span>
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          style={{
            padding: '7px 20px',
            background: '#111827',
            color: '#fff',
            border: 'none',
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '7px 20px',
            background: '#fff',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function IncreaseGuardrailsTab() {
  const [rows, setRows] = useState<GuardrailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow>(emptyDraft());
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<DraftRow>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:3001/guardrails');
      const data = await res.json();
      setRows(data.data || []);
    } catch {
      setError('Failed to load guardrails');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggleActive = async (row: GuardrailRow) => {
    setSaving(true);
    try {
      await fetch(`http://localhost:3001/guardrails/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await fetch(`http://localhost:3001/guardrails/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editDraft),
      });
      setEditingId(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleNewSave = async () => {
    if (!newDraft.levelName.trim() || !newDraft.actionRequired.trim()) return;
    setSaving(true);
    try {
      await fetch('http://localhost:3001/guardrails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDraft),
      });
      setAddingNew(false);
      setNewDraft(emptyDraft());
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    try {
      await fetch(`http://localhost:3001/guardrails/${id}`, { method: 'DELETE' });
      setDeleteConfirmId(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: GuardrailRow) => {
    setEditingId(row.id);
    setEditDraft({
      levelName: row.levelName,
      colorCode: row.colorCode,
      minPercent: row.minPercent,
      maxPercent: row.maxPercent,
      minAmount: row.minAmount,
      maxAmount: row.maxAmount,
      actionRequired: row.actionRequired,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    });
  };

  const btnStyle = (variant: 'ghost' | 'danger' | 'primary' | 'outline') => {
    const base: React.CSSProperties = {
      padding: '4px 11px',
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 500,
      cursor: 'pointer',
      border: 'none',
    };
    if (variant === 'ghost') return { ...base, background: 'transparent', color: '#374151', border: '1px solid #e5e7eb' };
    if (variant === 'danger') return { ...base, background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' };
    if (variant === 'primary') return { ...base, background: '#111827', color: '#fff' };
    return { ...base, background: '#fff', color: '#374151', border: '1px solid #d1d5db' };
  };

  return (
    <section style={{ paddingTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Increase Guardrails</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            Configure salary increase thresholds that determine review requirements. Rows are evaluated in sort order; the higher-severity result of percent vs. amount wins.
          </p>
        </div>
        {!addingNew && (
          <button
            type="button"
            style={btnStyle('primary')}
            onClick={() => { setAddingNew(true); setNewDraft(emptyDraft()); }}
          >
            + Add Row
          </button>
        )}
      </div>

      {addingNew && (
        <RowForm
          title="New Guardrail Row"
          draft={newDraft}
          onChange={(patch) => setNewDraft((d) => ({ ...d, ...patch }))}
          onSave={handleNewSave}
          onCancel={() => { setAddingNew(false); setNewDraft(emptyDraft()); }}
          saving={saving}
        />
      )}

      {loading && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Loading…</p>
      )}

      {!loading && error && (
        <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>No guardrail rows found. Add one above.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Level', '% Min', '% Max', 'Amt Min', 'Amt Max', 'Color', 'Action Required', 'Active', 'Actions'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 14px',
                      textAlign: 'left',
                      fontWeight: 600,
                      fontSize: 11,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: '1px solid #e5e7eb',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <>
                  <tr
                    key={row.id}
                    style={{
                      borderBottom: idx < rows.length - 1 ? '1px solid #f3f4f6' : 'none',
                      background: row.isActive ? '#fff' : '#fafafa',
                      opacity: row.isActive ? 1 : 0.55,
                    }}
                  >
                    <td style={{ padding: '12px 14px' }}>
                      <LevelBadge levelName={row.levelName} colorCode={row.colorCode} />
                    </td>
                    <td style={{ padding: '12px 14px', color: '#374151' }}>{fmt(row.minPercent)}</td>
                    <td style={{ padding: '12px 14px', color: '#374151' }}>{fmt(row.maxPercent)}</td>
                    <td style={{ padding: '12px 14px', color: '#374151' }}>{fmt(row.minAmount)}</td>
                    <td style={{ padding: '12px 14px', color: '#374151' }}>{fmt(row.maxAmount)}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ColorDot hex={row.colorCode} />
                        <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{row.colorCode}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', color: '#374151', maxWidth: 220 }}>{row.actionRequired}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(row)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 20,
                          fontSize: 11,
                          fontWeight: 600,
                          border: 'none',
                          cursor: 'pointer',
                          background: row.isActive ? '#dcfce7' : '#f3f4f6',
                          color: row.isActive ? '#16a34a' : '#9ca3af',
                        }}
                      >
                        {row.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" style={btnStyle('ghost')} onClick={() => startEdit(row)}>
                          Edit
                        </button>
                        {deleteConfirmId === row.id ? (
                          <>
                            <button type="button" style={btnStyle('danger')} onClick={() => handleDelete(row.id)} disabled={saving}>
                              Confirm
                            </button>
                            <button type="button" style={btnStyle('outline')} onClick={() => setDeleteConfirmId(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" style={btnStyle('danger')} onClick={() => setDeleteConfirmId(row.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editingId === row.id && (
                    <tr key={`${row.id}-edit`}>
                      <td colSpan={9} style={{ padding: '0 14px 14px' }}>
                        <RowForm
                          title="Edit Row"
                          draft={editDraft}
                          onChange={(patch) => setEditDraft((d) => ({ ...d, ...patch }))}
                          onSave={handleEditSave}
                          onCancel={() => setEditingId(null)}
                          saving={saving}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default IncreaseGuardrailsTab;
