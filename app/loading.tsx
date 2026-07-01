export default function RootLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Atlas
        </p>
        <h1 className="font-display italic text-6xl tracking-tight text-foreground/60">
          Loading<span className="text-primary">.</span>
        </h1>
        <div className="w-40 h-px bg-border mx-auto relative overflow-hidden">
          <div className="absolute inset-y-0 w-1/2 bg-primary animate-[progress_1.2s_ease-in-out_infinite]" />
        </div>
      </div>
      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
