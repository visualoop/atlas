export default function Placeholder({
  title,
  eyebrow,
  description,
}: {
  title: string;
  eyebrow: string;
  description: string;
}) {
  return (
    <div className="max-w-5xl mx-auto px-8 py-16">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
        {title.split(" ").map((word, i, arr) =>
          i === arr.length - 1 ? (
            <em key={i} className="italic font-display">
              {word}
            </em>
          ) : (
            <span key={i}>{word} </span>
          ),
        )}
      </h1>
      <p className="text-sm text-muted-foreground max-w-prose mt-6">{description}</p>
      <p className="eyebrow text-muted-foreground mt-12">Coming in this phase</p>
    </div>
  );
}
