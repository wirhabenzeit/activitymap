'use client';

/** The figures could not be read (only an admin gets this far). */
export default function AdminError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto max-w-3xl space-y-3 px-3 pt-6 text-sm sm:px-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p role="alert">
        The dashboard could not be loaded. The server log says why; the Convex
        dashboard shows whether the backend is running.
      </p>
      <button
        type="button"
        className="rounded-md border px-3 py-1.5 hover:bg-muted"
        onClick={() => retry()}
      >
        Try again
      </button>
    </main>
  );
}
