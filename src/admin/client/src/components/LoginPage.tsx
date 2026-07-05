import { useState, useEffect, type FormEvent } from 'react';
import { Button, Input, Label, Title1, Text } from '@fluentui/react-components';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function LoginPage() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState('');

  useEffect(() => {
    api<{ version: string }>('GET', '/api/version').then(r => {
      if (r.data.version) setVersion(r.data.version);
    });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await login(password);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f1f1f1',
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: 32, width: 380,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/admin/favicon.svg" alt="M365Mutator" style={{ height: 40, marginBottom: 12 }} />
          <Title1 block style={{ fontSize: 23 }}>M365Mutator</Title1>
          <Text size={300} style={{ color: '#555' }}>Admin</Text>
          {version && <Text size={200} style={{ color: '#999', display: 'block', marginTop: 4 }}>v{version}</Text>}
        </div>
        <form onSubmit={handleSubmit}>
          <Label htmlFor="password" style={{ display: 'block', marginBottom: 4 }}>Admin Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(_, d) => setPassword(d.value)}
            placeholder="Enter admin password"
            style={{ width: '100%', marginBottom: 16 }}
          />
          <Button
            appearance="primary"
            type="submit"
            disabled={loading || !password}
            style={{ width: '100%' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
          {error && (
            <Text size={200} style={{ color: 'var(--colorPaletteRedForeground1)', marginTop: 8, display: 'block' }}>
              {error}
            </Text>
          )}
        </form>
      </div>
    </div>
  );
}
