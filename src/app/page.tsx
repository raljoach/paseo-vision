import { Compass } from "lucide-react";

export default function Home() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
              <Compass className="h-7 w-7 text-primary" aria-hidden="true" />
            </div>
            <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-primary via-primary/90 to-primary/70 bg-clip-text text-transparent">
              Paseo
            </h1>
          </div>
          <p className="text-xl text-muted-foreground">
            Find out which trips actually work for you.
          </p>
          <p className="text-sm text-muted-foreground">
            The conversation experience is coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}
