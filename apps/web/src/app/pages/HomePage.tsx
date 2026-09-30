import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'

export function HomePage() {
  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold tracking-tight">SULUAN</h1>
        <CardDescription>
          Research submission, repository, discovery, and research intelligence
          for UA and its REO.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>Placeholder home screen — no features are wired yet.</p>
        <p className="text-muted-foreground">
          Submission, review, search, and assistant screens arrive with their
          corresponding architecture stages. All future data comes from the
          Workers API; nothing on this screen is presented as integrated
          functionality.
        </p>
        <Button variant="outline" disabled>
          Repository search (not yet available)
        </Button>
      </CardContent>
    </Card>
  )
}
