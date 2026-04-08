import React, { useState } from 'react';
import { Lock, User, ShieldCheck, Cpu, Terminal } from 'lucide-react';

interface AdminLoginProps {
  onLogin: () => void;
}

export function AdminLogin({ onLogin }: AdminLoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simple mock authentication
    if (username === 'admin' && password === 'admin123') {
      onLogin();
    } else {
      setError('ACCESS DENIED. INVALID CREDENTIALS.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Hi-Tech Background Elements */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="relative max-w-md w-full bg-slate-900/60 backdrop-blur-xl rounded-xl border border-cyan-500/30 shadow-[0_0_40px_rgba(6,182,212,0.15)] overflow-hidden">
        {/* Top Decorative Bar */}
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>
        
        <div className="p-8">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-cyan-500 blur-md opacity-40 rounded-full animate-pulse"></div>
              <div className="relative w-16 h-16 bg-slate-950 border border-cyan-500/50 rounded-full flex items-center justify-center">
                <ShieldCheck className="text-cyan-400" size={32} />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white tracking-wider">SYSTEM LOGIN</h2>
            <p className="text-cyan-400/70 font-mono text-xs mt-2 uppercase tracking-widest flex items-center gap-2">
              <Cpu size={12} />
              SmartFlow AI Core
            </p>
            <h3 className="mt-3 text-center font-mono text-xs text-cyan-300/80 leading-5">
              <div>Operator ID : admin</div>
              <div>Passcode : admin123</div>
            </h3>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-950/50 border border-red-500/50 text-red-400 p-3 rounded text-xs font-mono text-center flex items-center justify-center gap-2 animate-in fade-in slide-in-from-top-2">
                <Terminal size={14} />
                {error}
              </div>
            )}
            
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-mono text-cyan-500/80 mb-1.5 uppercase tracking-wider">Operator ID</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-4 w-4 text-cyan-600 group-focus-within:text-cyan-400 transition-colors" />
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 bg-slate-950/50 border border-cyan-900 rounded focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400 text-cyan-100 placeholder-cyan-900/50 sm:text-sm font-mono transition-all outline-none"
                    placeholder="admin"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-mono text-cyan-500/80 mb-1.5 uppercase tracking-wider">Passcode</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-cyan-600 group-focus-within:text-cyan-400 transition-colors" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 bg-slate-950/50 border border-cyan-900 rounded focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400 text-cyan-100 placeholder-cyan-900/50 sm:text-sm font-mono transition-all outline-none"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full relative group overflow-hidden rounded bg-cyan-950 border border-cyan-500/50 py-3 px-4 transition-all hover:bg-cyan-900 hover:shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:border-cyan-400"
            >
              <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
              <span className="relative text-sm font-mono font-bold text-cyan-400 tracking-widest uppercase flex items-center justify-center gap-2">
                Initialize Session
              </span>
            </button>
          </form>
        </div>
        
        {/* Bottom Decorative Elements */}
        <div className="bg-slate-950/80 p-3 border-t border-cyan-900/50 flex justify-between items-center">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></div>
            <div className="w-2 h-2 rounded-full bg-cyan-900"></div>
            <div className="w-2 h-2 rounded-full bg-cyan-900"></div>
          </div>
          <span className="text-[10px] font-mono text-cyan-600 tracking-widest">SECURE CONNECTION</span>
        </div>
      </div>
    </div>
  );
}
