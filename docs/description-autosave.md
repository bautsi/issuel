# Safe explicit description save (ISL-11)

GitHub is the only description source of truth. No description or draft is
stored in SQLite, browser storage or IndexedDB. ISL-12 recovery and comment
editing/deletion are outside this change.

## API and serialization

The existing `PATCH /api/repositories/:repositoryId/issues/:number` now accepts
exactly `{ body: string, baseline: string }` as a separate operation. Existing
session, origin, account header, repository discovery, push permission and App
Issues write checks still apply. Other fields cannot accompany this operation.

The existing server issue queue serializes description and metadata writes by
repository ID and issue number. Inside the queue, `readIssueDetail` reads GitHub
again and normalizes a null body to an empty string. If remote equals the
requested body, it returns that confirmed issue without PATCH. Otherwise remote
must exactly equal baseline; a mismatch returns HTTP 409 `description_conflict`.
Only `{ body }` goes to GitHub. The accepted baseline is the actual response body.

GET/compare/PATCH is best effort, not atomic compare-and-swap. Another GitHub
client can still write between GET and PATCH. The server queue is process-local;
it does not coordinate multiple server instances or external clients.

## Draft, safety and UI

The editor opens only after its initial GitHub check completes. The loaded raw
body is baseline; localDraft changes immediately on input. Typing, pasting,
switching modes, waiting and Cancel never submit a description write. Only
explicit Save submits a changed snapshot through the existing TanStack mutation
scope shared with metadata/comments. There is no debounce or background save.
One in-flight description snapshot is allowed; Save, Cancel and editing are
disabled while it runs. Confirmed success updates caches, shows Saved and exits
edit mode. If newer local input nevertheless arrives while a save is pending,
it is retained as Unsaved and requires another explicit Save.

Opening an editor, switching modes and lossless rich-text normalization never
change the controlled Markdown. Source input always preserves the exact complete
string, including alerts and HTML comments that cannot enter rich mode. Existing
Tiptap round-trip guards still reject lossy edits. Rejection reports Unsafe
Conversion, blocks Save and retains the last safe source; editing that source
allows another explicit Save. A rejected rich operation itself is not committed.

The compact status is Saved, Unsaved, Saving, Save Failed, Conflict or Unsafe
Conversion. Failures retain the editor and local input; Save remains available
to retry when the draft is changed, safe and not conflicting. There are no
automatic retries. An uncertain or failed write is followed by a
fresh protected read inside the same mutation scope: matching submitted Markdown
confirms success; a changed baseline establishes Conflict; failed verification
remains Save Failed. A cache update alone never confirms Saved.

Conflicts show selectable local and remote Markdown and offer Force Save.
Force Save opens the existing confirmation modal with an overwrite explanation.
Only explicit confirmation submits the local draft, using the displayed remote
Markdown as the expected baseline. The backend still rereads GitHub and refuses
another remote change; this operation never bypasses the normal conflict check.
Failed writes retain local input and may be retried against the confirmed baseline.

An unchanged editor cancels directly; a dirty editor first opens a modal with
Keep editing and Discard changes actions. Escape or Keep editing preserves the
draft. Confirmed Cancel/discard exits immediately and refetches the protected
Issue Detail with its existing account checks. Success updates the read cache;
failure shows a notification while the last loaded version remains visible.
Cancel never sends PATCH. Retrying its refresh never discards a newly opened draft.
Route
changes (including other issues and Back), logout and beforeunload use existing
unsaved-change guards. A pending write itself counts as unsaved.

Connection failures, transient server failures and rate limits during Save or
Cancel show a dismissible error notification in the upper-right corner. It never
takes focus, adds a backdrop or blocks editing, Cancel, navigation or logout.
The normal unsaved-change confirmation still applies to unsubmitted drafts.
Retry repeats only the interrupted explicit operation; a new failed attempt
shows the notification again even if the earlier notification was dismissed.
Save retry retains the confirmed baseline and server GET/compare/PATCH protection;
Cancel retry only GETs fresh detail; it never discards another draft. There is no timer, automatic
retry or online-event save. A valid conflict or permission/validation response
returns to its existing resolution UI instead of trapping the user in recovery.

The notification distinguishes an unconfirmed save (which may already have reached
GitHub) from a canceled edit whose refresh failed. A Save failure retains the
complete draft; confirmed Cancel has already discarded it. A refresh error does not insert an Issue unavailable card
above an already loaded issue. The timestamp explicitly means the last successful
GitHub check, not confirmation of the latest save attempt. Browser unload still
uses its native warning and cannot guarantee recovery after forced closure.

Open draft state is independent of query refetches. Issue/account route keys and
unmount guards prevent old responses from replacing a new editor. Successful
writes replace the matching detail cache and update existing list rows under the
same user/repository prefix. They neither refetch repository lists nor touch
comment caches.

Native unload warnings are browser-dependent. Confirmed departure, ignored
warnings, forced closure, browser crashes or restart can lose drafts. There is
no durable draft recovery until ISL-12.

## Manual acceptance (disposable issue only)

1. Open Edit description, switch Rich text/Markdown source repeatedly without
   typing, then wait. Save must be disabled and no description PATCH should occur;
   source stays exact. A null body and an empty source compare equally.
2. Type or paste several changes, switch modes and wait longer than one second.
   Expect Unsaved and no description PATCH. Press Save: expect Saving, then Saved,
   updated read mode and matching raw Markdown in GitHub.
3. Double-click Save or delay the response. Only one snapshot should submit;
   Save, Cancel and the editor remain disabled while pending. Change
   title/status/labels/assignees too: description PATCH must contain only body,
   and metadata must remain correct.
4. While the local editor is open, change the remote body in GitHub, then type
   locally and press Save. Expect Conflict, no overwrite, selectable local/remote
   source and no writes after further typing. Press Force Save: declining the
   modal must keep both versions untouched; confirming must save the local source.
   Change remote again before confirming: expect another Conflict and no overwrite.
   Press Cancel: Keep editing and Escape preserve the draft; Discard changes
   refetches remote and exits without a write. Disconnect before that read:
   expect read mode with the last loaded data and a refresh-error notification;
   Retry after reconnecting must update remote data without sending PATCH.
5. Simulate a failed request or unavailable API. Expect retained input and Save
   Failed with a clearly worded upper-right notification. In DevTools Offline,
   verify editing and Cancel remain available. Dismiss the notification, then
   retry Save: a new failure must notify again. Navigation/logout should use only
   the existing unsaved-change confirmation. Confirm Cancel while still offline:
   it must exit editing and show a refresh notification, with no PATCH.
   Restore connectivity, then Retry: expect confirmed save or the real conflict
   UI if remote changed. Simulate a lost successful PATCH response: a fresh
   read of matching source should confirm success without another PATCH.
   Repeat with Cancel: offline refresh must show its own recovery message rather
   than a card above the title; online Retry must refetch without PATCH.
6. Use alerts, HTML comments, references and other unsupported rich syntax in
   Source; exact source edits can save after pressing Save. Try an unsafe rich
   conversion: retain source and block Save until Source is edited. Rendered HTML stays inert.
7. With unsaved/error/conflict content, try another issue, Back to issues, browser
   Back, reload, close and logout. Cancel departure to keep input. Different
   issues/accounts must never share drafts. Cancel an unchanged editor directly;
   cancel a changed editor only through the modal confirmation. Both must GET
   fresh Issue Detail and update the read view when available; a read failure
   must not force the user to remain in editing. Neither action sends PATCH.
   Successful saves must leave comments and list pagination intact.

Local lint/typecheck/build do not establish browser or live GitHub write success.
