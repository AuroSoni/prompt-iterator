import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn } from "@/lib/auth"

// The single-user sign-in gate, shown only when Supabase is configured and no
// session is active. There is no sign-up or password-reset flow — the one
// account is created (and new sign-ups disabled) in the Supabase dashboard.
export function LoginScreen() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await signIn(email, password)
      // On success the auth listener swaps this screen for the shell.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.")
      setPending(false)
    }
  }

  return (
    <div className="flex h-svh items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
      >
        <h1 className="text-lg font-semibold tracking-tight">Prompt Workbench</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to your library.
        </p>

        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </div>
  )
}
