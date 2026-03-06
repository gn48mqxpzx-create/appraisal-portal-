import { useState } from 'react';

interface LoginPageProps {
  onLogin: (email: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      await onLogin(email.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ 
      backgroundColor: '#f9fafb', 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{ 
        backgroundColor: '#fff', 
        padding: '40px', 
        borderRadius: '12px', 
        border: '1px solid #e5e7eb',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
        maxWidth: '400px',
        width: '100%'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: '600', margin: '0 0 8px 0', color: '#1f2937' }}>
            Appraisal Portal
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
            Sign in with your email address
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '13px', 
              fontWeight: '600', 
              marginBottom: '6px', 
              color: '#374151' 
            }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your.email@vaplatinum.com.au"
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: isLoading ? '#f3f4f6' : '#fff',
                color: '#1f2937'
              }}
            />
          </div>

          {error && (
            <div style={{ 
              marginBottom: '20px', 
              padding: '12px', 
              backgroundColor: '#fef2f2', 
              border: '1px solid #fecaca', 
              borderRadius: '6px',
              fontSize: '13px',
              color: '#991b1b'
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !email.trim()}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: isLoading || !email.trim() ? '#9ca3af' : '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: isLoading || !email.trim() ? 'not-allowed' : 'pointer'
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
