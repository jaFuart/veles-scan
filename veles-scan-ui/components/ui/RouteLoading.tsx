import { Skeleton } from "@/components/ui/Skeleton";

function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 pb-4 pt-4 md:px-8 md:pt-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[1560px] flex-col md:min-h-[calc(100vh-3rem)]">
        <header className="mb-6 grid grid-cols-[1fr_auto_1fr] items-center md:mb-8">
          <Skeleton className="h-11 w-11 rounded-md" />
          <Skeleton className="mx-auto h-12 w-[190px] rounded-xl" />
          <Skeleton className="ml-auto h-10 w-28 rounded-md" />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col px-4 py-6 md:px-8">
      <header className="mb-6 md:mb-8">
        <Skeleton className="mx-auto h-12 w-[190px] rounded-xl" />
      </header>
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center pb-8">{children}</main>
    </div>
  );
}

export function RootPageSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[28px] border border-black/10 bg-[var(--panel)] p-6">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="mt-4 h-11 w-3/4 rounded-xl" />
        <Skeleton className="mt-3 h-4 w-full rounded-full" />
        <Skeleton className="mt-2 h-4 w-5/6 rounded-full" />
      </div>
    </div>
  );
}

export function AuthPageSkeleton() {
  return (
    <AuthShell>
      <section className="rounded-xl border border-black/15 bg-[var(--panel)] p-5 md:p-6">
        <Skeleton className="h-8 w-2/3 rounded-xl" />
        <Skeleton className="mt-2 h-4 w-5/6 rounded-full" />
        <div className="mt-6 space-y-3">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton className="h-4 w-28 rounded-full" />
        </div>
        <Skeleton className="mt-5 h-10 w-full rounded-md" />
      </section>
    </AuthShell>
  );
}

export function ProjectsPageSkeleton() {
  return (
    <DashboardShell>
      <Skeleton className="mb-5 h-12 w-56 rounded-2xl" />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-black bg-[var(--panel)] p-4">
            <Skeleton className="h-7 w-3/4 rounded-xl" />
            <Skeleton className="mt-2 h-4 w-full rounded-full" />
            <div className="mt-10 flex items-center justify-between gap-3">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-4 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </section>
    </DashboardShell>
  );
}

export function ProjectEditorSkeleton() {
  return (
    <DashboardShell>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Skeleton className="mt-1 h-10 w-10 rounded-md" />
          <div>
            <Skeleton className="h-10 w-72 rounded-2xl" />
            <Skeleton className="mt-2 h-4 w-40 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-10 w-16 rounded-md" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px] xl:gap-8 2xl:grid-cols-[minmax(0,1fr)_500px]">
        <section className="space-y-4 xl:max-w-[980px]">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-black/15 bg-[var(--panel)] p-4 md:p-5">
              <Skeleton className="h-7 w-48 rounded-xl" />
              <Skeleton className="mt-4 h-12 w-full rounded-md" />
              <Skeleton className="mt-2 h-24 w-full rounded-xl" />
            </div>
          ))}
        </section>
        <aside className="space-y-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-black/15 bg-[var(--panel)] p-4 md:p-5">
              <Skeleton className="h-7 w-40 rounded-xl" />
              <Skeleton className="mt-4 h-6 w-28 rounded-full" />
              <Skeleton className="mt-3 h-4 w-full rounded-full" />
              <Skeleton className="mt-2 h-4 w-2/3 rounded-full" />
            </div>
          ))}
        </aside>
      </div>
    </DashboardShell>
  );
}

export function FinancePageSkeleton() {
  return (
    <DashboardShell>
      <Skeleton className="mb-6 h-12 w-40 rounded-2xl" />
      <div className="mb-6 grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="rounded-xl border border-black bg-[var(--panel)] p-5">
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton className="mt-3 h-10 w-40 rounded-xl" />
          <Skeleton className="mt-4 h-4 w-full rounded-full" />
          <Skeleton className="mt-2 h-4 w-5/6 rounded-full" />
        </div>
        <div className="rounded-xl border border-black bg-[var(--panel)] p-5">
          <Skeleton className="h-4 w-44 rounded-full" />
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index}>
                <Skeleton className="h-4 w-20 rounded-full" />
                <Skeleton className="mt-3 h-8 w-28 rounded-xl" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-black bg-[var(--panel)] p-5">
          <Skeleton className="h-4 w-40 rounded-full" />
          <Skeleton className="mt-4 h-11 w-full rounded-md" />
          <Skeleton className="mt-2 h-11 w-full rounded-md" />
          <Skeleton className="mt-4 h-4 w-32 rounded-full" />
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="mt-2 h-4 w-full rounded-full" />
          ))}
        </div>
      </div>
      <section className="overflow-hidden rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="border-b border-[var(--line)] py-3 last:border-b-0">
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="mt-2 h-4 w-2/3 rounded-full" />
          </div>
        ))}
      </section>
    </DashboardShell>
  );
}

export function SettingsPageSkeleton() {
  return (
    <DashboardShell>
      <Skeleton className="mb-5 h-12 w-72 rounded-2xl" />
      <article className="max-w-3xl rounded-xl border border-black bg-[var(--panel)] p-4 md:p-5">
        <Skeleton className="h-8 w-32 rounded-xl" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-md" />
          ))}
        </div>
        <Skeleton className="mt-5 h-10 w-40 rounded-md" />
      </article>
    </DashboardShell>
  );
}

export function AdminPageSkeleton() {
  return (
    <DashboardShell>
      <Skeleton className="mb-5 h-12 w-48 rounded-2xl" />
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-36 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-[24px] border border-black bg-[var(--panel)] p-4">
            <Skeleton className="h-4 w-28 rounded-full" />
            <Skeleton className="mt-3 h-9 w-24 rounded-xl" />
            <Skeleton className="mt-3 h-4 w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
          <Skeleton className="h-8 w-56 rounded-xl" />
          <Skeleton className="mt-5 h-[280px] w-full rounded-[24px]" />
        </div>
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-[28px] border border-black bg-[var(--panel)] p-5 md:p-6">
              <Skeleton className="h-8 w-44 rounded-xl" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((__, innerIndex) => (
                  <Skeleton key={innerIndex} className="h-20 w-full rounded-2xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}

export function SupportPageSkeleton() {
  return (
    <DashboardShell>
      <Skeleton className="mb-5 h-12 w-44 rounded-2xl" />
      <div className="max-w-3xl space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-black bg-[var(--panel)] p-5">
            <Skeleton className="h-7 w-52 rounded-xl" />
            <Skeleton className="mt-4 h-4 w-full rounded-full" />
            <Skeleton className="mt-2 h-4 w-5/6 rounded-full" />
            <Skeleton className="mt-2 h-4 w-2/3 rounded-full" />
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
