export function IconeAtivo({ symbol, assetClass }: { symbol: string; assetClass: string }) {
  const base = symbol.slice(0, 3);
  
  if (symbol === 'XAGUSD' || base === 'XAG') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <rect x="2" y="7" width="20" height="10" rx="2" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1" />
        <text x="12" y="14.5" fontSize="8" fill="#475569" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">PRATA</text>
      </svg>
    );
  }
  
  if (symbol === 'XAUUSD' || base === 'XAU') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <rect x="2" y="7" width="20" height="10" rx="2" fill="#fde047" stroke="#eab308" strokeWidth="1" />
        <text x="12" y="14.5" fontSize="8" fill="#854d0e" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">OURO</text>
      </svg>
    );
  }

  if (base === 'BTC') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <circle cx="12" cy="12" r="10" fill="#f59e0b" />
        <text x="12" y="16" fontSize="12" fill="#fff" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">₿</text>
      </svg>
    );
  }
  
  if (base === 'ETH') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <circle cx="12" cy="12" r="10" fill="#627eea" />
        <text x="12" y="16" fontSize="12" fill="#fff" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">Ξ</text>
      </svg>
    );
  }

  if (base === 'SOL') {
    return (
      <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <circle cx="12" cy="12" r="10" fill="#14F195" />
        <text x="12" y="16" fontSize="12" fill="#000" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">S</text>
      </svg>
    );
  }

  // Bandeiras (aproximações vetoriais)
  if (base === 'EUR') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#1d4ed8" />
         <circle cx="12" cy="12" r="6" fill="none" stroke="#fde047" strokeWidth="2" strokeDasharray="2 3" />
       </svg>
     );
  }

  if (base === 'USD' || symbol === 'DXY') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#fff" />
         <path d="M0 4h24M0 10h24M0 16h24M0 22h24" stroke="#ef4444" strokeWidth="2" />
         <rect x="0" y="0" width="12" height="12" fill="#1e3a8a" />
         <circle cx="6" cy="6" r="2" fill="#fff" />
       </svg>
     );
  }

  if (base === 'GBP') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#1e3a8a" />
         <path d="M0 0l24 24M0 24L24 0" stroke="#fff" strokeWidth="3" />
         <path d="M12 0v24M0 12h24" stroke="#fff" strokeWidth="6" />
         <path d="M12 0v24M0 12h24" stroke="#ef4444" strokeWidth="4" />
       </svg>
     );
  }
  
  if (base === 'JPY' || symbol.endsWith('JPY')) {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
         <rect width="24" height="24" fill="#fff" />
         <circle cx="12" cy="12" r="6" fill="#ef4444" />
       </svg>
     );
  }

  if (base === 'AUD') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#1e3a8a" />
         <path d="M0 0l12 12M0 12l12-12" stroke="#fff" strokeWidth="1.5" />
         <path d="M6 0v12M0 6h12" stroke="#fff" strokeWidth="3" />
         <path d="M6 0v12M0 6h12" stroke="#ef4444" strokeWidth="2" />
         <circle cx="18" cy="18" r="2" fill="#fff" />
         <circle cx="16" cy="6" r="3" fill="#fff" />
       </svg>
     );
  }

  if (base === 'NZD') {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#1e3a8a" />
         <path d="M0 0l12 12M0 12l12-12" stroke="#fff" strokeWidth="1.5" />
         <path d="M6 0v12M0 6h12" stroke="#fff" strokeWidth="3" />
         <path d="M6 0v12M0 6h12" stroke="#ef4444" strokeWidth="2" />
         <circle cx="18" cy="18" r="2" fill="#ef4444" stroke="#fff" strokeWidth="1" />
       </svg>
     );
  }

  if (base === 'CAD' || symbol.endsWith('CAD')) {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#ef4444" />
         <rect x="6" y="0" width="12" height="24" fill="#fff" />
         <path d="M12 4l3 6h2l-2 4h1l-4 6-4-6h1l-2-4h2z" fill="#ef4444" />
       </svg>
     );
  }

  if (base === 'CHF' || symbol.endsWith('CHF')) {
     return (
       <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
         <rect width="24" height="24" fill="#ef4444" />
         <path d="M12 4v16M4 12h16" stroke="#fff" strokeWidth="4" />
       </svg>
     );
  }

  if (assetClass === 'index') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '24px', height: '24px', color: '#6366f1' }}>
        <path d="M3 3v18h18" />
        <path d="M18 9l-5 5-4-4-6 6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', borderRadius: '4px' }}>
      <rect width="24" height="24" fill="#e2e8f0" />
      <text x="12" y="16" fontSize="10" fill="#475569" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">{symbol.slice(0, 2)}</text>
    </svg>
  );
}
