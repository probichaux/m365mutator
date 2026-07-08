import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, Spinner, Text, Textarea, Tooltip, tokens,
} from '@fluentui/react-components';
import {
  CheckmarkRegular, CheckmarkCircle20Filled, DismissCircle20Filled, CloudArrowDownRegular,
} from '@fluentui/react-icons';
import { api } from '../api';
import { useToast } from './ToastProvider';

export type TargetCategory = 'identities' | 'mail' | 'calendar' | 'onedrive' | 'sharepoint';
type RunStyle = 'explicit' | 'random';

interface CheckResult {
  item: string;
  ok: boolean;
  error?: string;
}

interface PoolInfo {
  pool: number;
  total: number;
  truncated: boolean;
}

const PERCENT_PRESETS = [5, 10, 25, 50, 100];

function textToItems(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l !== '');
}

/** Pull every non-empty cell out of a CSV file, one target per cell. */
function parseCsv(content: string): string[] {
  return content
    .split(/\r?\n/)
    .flatMap(line => line.split(/[,;]/))
    .map(cell => cell.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter(cell => cell !== '');
}

/** How many items a percentage selects from a pool, at least 1 (0 for an empty pool). Mirrors the server. */
function sampleSize(pool: number, percent: number): number {
  if (pool <= 0) return 0;
  return Math.min(pool, Math.max(1, Math.round((pool * percent) / 100)));
}

/**
 * The full control set for one target category. Explicit mode edits a list;
 * Random mode picks a percentage of the tenant, sampled at run time. Loads and
 * persists only its own category so each workload page is independent.
 *
 * `onReadyChange` reports whether the category has runnable saved targets, so the
 * page can gate its "Do it now" action: explicit needs saved items, random is
 * always ready (it samples the tenant live).
 */
export default function TargetPanel(
  { category, onReadyChange }: { category: TargetCategory; onReadyChange?: (ready: boolean) => void },
) {
  const { t } = useTranslation('targets');
  const showToast = useToast();

  const [runStyle, setRunStyle] = useState<RunStyle>('explicit');
  const [percent, setPercent] = useState(10);
  const [text, setText] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api<Record<string, { items?: string[]; runStyle?: RunStyle; randomPercent?: number }>>('GET', '/api/targets').then(r => {
      if (r.status !== 200) return;
      const slice = r.data[category];
      if (slice) {
        const items = slice.items ?? [];
        setText(items.join('\n'));
        setSavedCount(items.length);
        if (slice.runStyle === 'random') setRunStyle('random');
        if (typeof slice.randomPercent === 'number') setPercent(slice.randomPercent);
      }
    });
  }, [category]);

  const persist = (cat: TargetCategory, partial: Record<string, unknown>) =>
    api<{ success: boolean; error?: string }>('PUT', `/api/targets/${cat}`, partial);

  // Tell the page whether "Do it now" should be enabled: random samples the
  // tenant live (always ready); explicit needs saved targets to run against.
  useEffect(() => {
    onReadyChange?.(runStyle === 'random' ? true : savedCount > 0);
  }, [runStyle, savedCount, onReadyChange]);

  // In random mode, fetch the tenant pool size once so the live count is real.
  useEffect(() => {
    if (runStyle !== 'random' || pool || poolLoading) return;
    setPoolLoading(true);
    api<{ items?: string[]; total?: number; truncated?: boolean; error?: string }>('POST', '/api/targets/load', { category })
      .then(r => {
        if (r.status === 200 && r.data.items) {
          setPool({ pool: r.data.items.length, total: r.data.total ?? r.data.items.length, truncated: !!r.data.truncated });
        }
      })
      .finally(() => setPoolLoading(false));
  }, [runStyle, category, pool, poolLoading]);

  const changeRunStyle = (style: RunStyle) => {
    if (style === runStyle) return;
    setRunStyle(style);
    setResults(null);
    if (style === 'explicit') setPool(null); // drop stale pool count
    persist(category, { runStyle: style });
  };

  const commitPercent = (value: number) => {
    const v = Math.min(100, Math.max(1, Math.round(value)));
    setPercent(v);
    persist(category, { randomPercent: v });
  };

  const save = async () => {
    setSaving(true);
    const items = textToItems(text);
    const r = await persist(category, { items });
    setSaving(false);
    if (r.data.success) setSavedCount(items.length);
    showToast(
      r.data.success ? t('toast.saved') : (r.data.error || t('toast.saveFailed')),
      r.data.success ? 'success' : 'error',
    );
  };

  const importCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const items = parseCsv(String(reader.result ?? ''));
      if (items.length === 0) {
        showToast(t('toast.csvEmpty'), 'warning');
        return;
      }
      setText(prev => [...textToItems(prev), ...items].join('\n'));
      setResults(null);
    };
    reader.onerror = () => showToast(t('toast.csvReadFailed'), 'error');
    reader.readAsText(file);
  };

  const load = async () => {
    setLoading(true);
    const r = await api<{ items?: string[]; total?: number; truncated?: boolean; error?: string }>(
      'POST', '/api/targets/load', { category },
    );
    setLoading(false);
    if (r.status === 200 && r.data.items) {
      const items = r.data.items;
      setText(items.join('\n'));
      setResults(null);
      if (category === 'mail') await persist('calendar', { items });
      if (r.data.truncated) {
        showToast(t('toast.loadTruncated', { count: items.length, total: r.data.total ?? items.length }), 'warning');
      } else if (items.length === 0) {
        showToast(t('toast.loadEmpty'), 'warning');
      } else {
        showToast(
          category === 'mail' ? t('toast.loadedMirrored', { count: items.length }) : t('toast.loadedCount', { count: items.length }),
          'success',
        );
      }
    } else {
      showToast(r.data.error || t('toast.loadFailed'), 'error');
    }
  };

  const check = async () => {
    const items = textToItems(text);
    if (items.length === 0) {
      showToast(t('toast.nothingToCheck'), 'warning');
      return;
    }
    setChecking(true);
    setResults(null);
    const r = await api<{ results?: CheckResult[]; error?: string }>(
      'POST', '/api/targets/check', { category, items },
    );
    setChecking(false);
    if (r.status === 200 && r.data.results) {
      setResults(r.data.results);
      const failed = r.data.results.filter(x => !x.ok).length;
      showToast(
        failed === 0 ? t('toast.checkAllOk', { total: items.length }) : t('toast.checkFailures', { failed, total: items.length }),
        failed === 0 ? 'success' : 'warning',
      );
    } else {
      showToast(r.data.error || t('toast.checkFailed'), 'error');
    }
  };

  const errText = (e: string): string =>
    e === 'not found' ? t('errors.notFound')
      : e === 'not a valid UPN' ? t('errors.invalidUpn')
        : e === 'not a valid URL' ? t('errors.invalidUrl')
          : e;

  const isUrl = category === 'sharepoint';

  const segStyle = (active: boolean): React.CSSProperties => ({
    border: 'none', cursor: 'pointer', padding: '7px 20px', borderRadius: 6,
    fontSize: 13, fontWeight: 600,
    color: active ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground2,
    background: active ? tokens.colorNeutralBackground1 : 'transparent',
    boxShadow: active ? tokens.shadow2 : 'none',
  });

  return (
    <Card>
      <Text size={200} block style={{ color: tokens.colorNeutralForeground3 }}>{t(`categories.${category}.hint`)}</Text>

      {/* Run-style: segmented control */}
      <div role="tablist" aria-label={t('runStyleLabel')}
        style={{ display: 'inline-flex', background: tokens.colorNeutralBackground3, borderRadius: 8, padding: 3, margin: '12px 0' }}>
        <button role="tab" aria-selected={runStyle === 'explicit'} style={segStyle(runStyle === 'explicit')} onClick={() => changeRunStyle('explicit')}>
          {t('explicit')}
        </button>
        <button role="tab" aria-selected={runStyle === 'random'} style={segStyle(runStyle === 'random')} onClick={() => changeRunStyle('random')}>
          {t('random')}
        </button>
      </div>

      {runStyle === 'explicit' ? (
        <>
          <Textarea
            value={text}
            onChange={(_, d) => { setText(d.value); setResults(null); }}
            placeholder={t(isUrl ? 'placeholderUrls' : 'placeholderUpns')}
            resize="vertical"
            textarea={{ style: { minHeight: 180, fontFamily: 'var(--fontFamilyMonospace)' } }}
            style={{ width: '100%' }}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Tooltip content={t('loadFromTenant')} relationship="label">
              <Button appearance="outline" icon={loading ? <Spinner size="tiny" /> : <CloudArrowDownRegular />}
                disabled={loading} onClick={load}>
                {loading ? t('loading') : t('load')}
              </Button>
            </Tooltip>
            <Tooltip content={t('importCsv')} relationship="label">
              <Button appearance="outline" onClick={() => fileRef.current?.click()}>
                {t('upload')}
              </Button>
            </Tooltip>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) { importCsv(f); e.target.value = ''; } }} />
            <Button appearance="outline" icon={checking ? <Spinner size="tiny" /> : <CheckmarkRegular />}
              disabled={checking} onClick={check}>
              {checking ? t('checking') : t('check')}
            </Button>
            <Button appearance="primary" onClick={save} disabled={saving} style={{ marginLeft: 'auto' }}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>

          {results && (
            <div style={{ marginTop: 12 }}>
              {results.map((r, i) => (
                <div key={`${r.item}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  {r.ok
                    ? <CheckmarkCircle20Filled style={{ color: tokens.colorPaletteGreenForeground1, flexShrink: 0 }} />
                    : <DismissCircle20Filled style={{ color: tokens.colorPaletteRedForeground1, flexShrink: 0 }} />}
                  <Text size={300} style={{ fontFamily: 'var(--fontFamilyMonospace)' }}>{r.item}</Text>
                  {!r.ok && r.error && (
                    <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>{errText(r.error)}</Text>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{
          border: `1px dashed ${tokens.colorNeutralStroke2}`, borderRadius: 8, padding: 20,
          background: tokens.colorNeutralBackground2,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 12 }}>
            <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, color: tokens.colorBrandForeground1 }}>
              {percent}<span style={{ fontSize: 22 }}>%</span>
            </span>
            <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
              {poolLoading
                ? t('randomCounting')
                : pool
                  ? t('randomModify', { count: sampleSize(pool.pool, percent), pool: pool.pool })
                  : t('randomModifyUnknown', { percent })}
            </Text>
          </div>
          <input type="range" min={1} max={100} value={percent}
            onChange={e => setPercent(+e.target.value)}
            onPointerUp={e => commitPercent(+(e.target as HTMLInputElement).value)}
            onKeyUp={e => commitPercent(+(e.target as HTMLInputElement).value)}
            style={{ width: '100%', accentColor: tokens.colorBrandBackground }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {PERCENT_PRESETS.map(p => (
              <button key={p} onClick={() => commitPercent(p)}
                style={{
                  border: `1px solid ${percent === p ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2}`,
                  background: percent === p ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground1,
                  color: percent === p ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground2,
                  borderRadius: 20, padding: '5px 14px', fontSize: 12, cursor: 'pointer',
                  fontWeight: percent === p ? 600 : 400,
                }}>
                {p}%
              </button>
            ))}
          </div>
          <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: 12 }}>
            {t('randomPoolNote')}
            {pool?.truncated ? ' ' + t('randomTruncatedNote', { pool: pool.pool, total: pool.total }) : ''}
          </Text>
        </div>
      )}
    </Card>
  );
}
