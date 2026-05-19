import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Music } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <Music className="w-16 h-16 text-primary/30 mb-4" />
      <h1 className="text-2xl font-semibold text-primary mb-2">Page not found</h1>
      <p className="text-sm text-muted-foreground mb-8">This page doesn't exist.</p>
      <Link href="/">
        <Button variant="default" className="hover-elevate">Back to Player</Button>
      </Link>
    </div>
  );
}
