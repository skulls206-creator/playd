import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <h1 className="text-6xl font-bold text-primary mb-4 font-mono">404</h1>
      <p className="text-xl text-muted-foreground mb-8">Track not found.</p>
      <Link href="/">
        <Button variant="default" className="hover-elevate">Return to Player</Button>
      </Link>
    </div>
  );
}
