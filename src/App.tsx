import { Button } from "@/components/ui/button"

function App() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">prompt-iterator</h1>
        <p className="text-muted-foreground">
          Vite + React + Tailwind CSS v4 + shadcn/ui
        </p>
      </div>
      <div className="flex gap-3">
        <Button>Get started</Button>
        <Button variant="outline">Documentation</Button>
      </div>
    </div>
  )
}

export default App
