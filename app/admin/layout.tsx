export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      colorScheme: 'light',
      backgroundColor: '#f8fafc',
      color: '#0f172a',
      minHeight: '100vh',
    }}>
      <style>{`
        * { color-scheme: light !important; }
        input, select, textarea {
          color: #0f172a !important;
          background-color: #ffffff !important;
          -webkit-text-fill-color: #0f172a !important;
        }
        input::placeholder { color: #94a3b8 !important; -webkit-text-fill-color: #94a3b8 !important; }
        option { color: #0f172a !important; background-color: #ffffff !important; }
      `}</style>
      {children}
    </div>
  )
}
