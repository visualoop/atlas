export default function SecurityPage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="eyebrow">Sessions</p>
        <div className="border border-border p-6 text-sm text-muted-foreground">
          Session listing + device management wires in fully in a follow-up to Phase 0.
        </div>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">Two-factor authentication</p>
        <div className="border border-border p-6 text-sm text-muted-foreground">
          TOTP enrollment lands in Phase 1.
        </div>
      </section>
    </div>
  );
}
