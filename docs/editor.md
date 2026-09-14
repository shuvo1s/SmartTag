# Professional canvas designer

The designer edits the **canonical DesignDocument** of a draft TemplateVersion. The canvas library
(Fabric.js 7) provides pointer interaction, selection handles and hit-testing; it never owns
design data and nothing it produces is ever stored.

Route: `/templates/:templateId/versions/:versionId/edit` (desktop-first; below 1024 px wide the
page explains that the designer needs a larger screen). Entry points: **Edit in designer** on a
draft's version page, **Open designer (view only)** otherwise.

## Canvas architecture

```text
 GET version ─▶ parseDesignDocument (migrate + validate) ─▶ EditorStore.document (canonical)
                                                                │  ▲
                                   identity-diffed sync ────────┘  │ one command per finished gesture
                                                                ▼  │
                                         EditorCanvas (canvas-adapter, Fabric.js)
                                         ArtworkFabricObject per canonical object
                                                                │
                           drawArtwork(canonical object, RenderServices) — same layout,
                           symbol geometry and image placement code as the SVG renderer
```

| Package / module                    | Responsibility                                                                                                                                      | Depends on Fabric |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `document-schema`, `document-utils` | Canonical model, validation, precision helpers, hashing                                                                                             | no                |
| `rendering-core`                    | Text layout engine, barcode/QR symbol geometry, image placement, scene → SVG                                                                        | no                |
| `barcode-core` / `barcode-bwip`     | Symbology rules and validation / encoder adapter (bwip-js)                                                                                          | no                |
| `editor-core`                       | Framework-free editor: commands, history, store, snapping, placement, viewport math, object factory, save controller                                | no                |
| `canvas-adapter`                    | The **only** Fabric.js dependency: `EditorCanvas`, `ArtworkFabricObject`, guides/overlays, browser font registry, canvas text measurer, image cache | yes               |
| `apps/web/src/features/editor`      | React shell: toolbars, layers, properties, asset picker, preview/compare, shortcuts                                                                 | via adapter       |

- **One Fabric object per canonical object.** `ArtworkFabricObject` holds the canonical snapshot
  and draws only from it (`_render` → `drawArtwork`). Fabric contributes transform, controls and
  hit-testing. Object caching is off so text and symbols re-lay out at the true size while
  resizing instead of stretching a bitmap.
- **Guides are not objects.** Bleed, trim, safe area, margins, dieline and punch holes are drawn
  in Fabric's `before:render`/`after:render` hooks from `buildPageGuides`. They cannot be
  selected, moved or saved. Dieline features are production geometry shown read-only in the page
  settings panel, never editable as artwork.
- **Services are injected.** `RenderServices` (text layout engine, barcode encoder, font provider,
  image provider) are created once per session in the web app's composition root
  (`features/rendering/rendering-services.ts`); tests use Node stand-ins.
- **Fabric JSON is never produced for storage.** There is no `toJSON`/`loadFromJSON` path; the
  strict schema would reject Fabric keys anyway.

## State separation

| State                                                               | Lives in                         | Saved |
| ------------------------------------------------------------------- | -------------------------------- | ----- |
| Canonical document                                                  | `EditorStore.document`           | yes   |
| Active page, selection, clipboard, `interacting`, undo/redo history | `EditorStore`                    | no    |
| Zoom, pan, pointer position, panel/mode, text-editing id, notices   | `EditorSession` UI state (React) | no    |
| Hover, handles, snap guides, active transform                       | Fabric (canvas-adapter)          | no    |
| Font/image loading state, text layout cache, encoded symbol cache   | Rendering resources              | no    |
| Revision, last saved hash, save status                              | `SaveController`                 | no    |

React components subscribe to narrow slices (`useSyncExternalStore`). The canvas subscribes to the
store directly, so pointer movement never re-renders React.

## Round-trip integrity

**One Fabric unit is one PDF point in trim space.** Zoom and pan exist only in Fabric's viewport
transform (`zoom × 96/72` CSS px per point, plus pan) and never touch object values.

```text
Canonical → Fabric   left = x + width/2   top = y + height/2   angle = rotation
                     originX/Y = center, scaleX/Y = 1, skew = 0, flip = false
Fabric → Canonical   qrDecompose(calcTransformMatrix())  (also inside active selections)
                     width = fabric.width × |scaleX|   x = translateX − width/2   rotation = angle
```

- After every gesture scale is **baked into `width`/`height`** and Fabric is reset to unit scale.
- `reconcileObject` compares measured values with the canonical ones: a value within half the
  rounding unit **keeps its exact stored number** (no float noise from matrix math); changed
  values are normalized (see [coordinate-system.md](coordinate-system.md#precision)).
- Skew and mirroring are locked in the UI; if a transform still contains them it is reported as
  unsupported and the canonical object is left unchanged.
- Lines keep a zero-height frame; only length and rotation change.

Tests (`packages/canvas-adapter/test/round-trip.test.ts`) prove, per object type and for complete
documents (v2 sample, migrated v1): Canonical → Fabric → Canonical is identical and hashes
identically; 20 open → canvas → save cycles do not drift; every zoom level and pan reads back the
same pages; moves change only `x`/`y`; resize leaves no scale factors; rotation normalizes to
`[0, 360)`. The E2E suite additionally checks that zooming, panning and a no-op save keep the
server's `documentHash` and revision.

## Editing

| Capability               | Behaviour                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select                   | Click, Shift-click, marquee, Ctrl+A (page), or in the Layers panel (Shift/Ctrl-click adds). Locked and hidden objects are not hit on the canvas but can be selected in Layers.                                        |
| Move / resize / rotate   | Handles and drag; exact **X / Y / W / H / rotation** fields in the document's display unit (mm, cm, in, pt). Values are converted to points once and normalized.                                                      |
| Nudge                    | Arrow keys 0.25 mm (in documents measured in inches: 0.01 in; points: 1 pt); Shift + arrows 1 mm (0.1 in; 10 pt). Rapid nudges coalesce into one undo step. Locked objects never move.                                |
| Snapping                 | Page centre, trim, safe, bleed, margin edges, and edges/centres of other visible objects; engages within 6 screen px, draws smart guides, hold **Alt** to bypass.                                                     |
| Align / distribute       | Left, centre, right, top, middle, bottom (one object aligns to the trim box, several to their joint bounds); distribute horizontally/vertically (3+ objects). Locked objects do not move.                             |
| Layers                   | Top-first list mapped to canonical `zIndex` (rewritten to `0…n−1`): select, rename (double-click/F2), drag to reorder, forward/backward/front/back, show/hide, lock/unlock. Alt+↑/↓ moves between layers.             |
| Pages                    | Front/back tabs; each page has its own objects, selection is per page, undo restores the page it happened on.                                                                                                         |
| Duplicate / copy / paste | Ctrl+D, Ctrl+C/V; every copy gets **new stable ids**, offset 2 mm (1/16 in), group membership dropped when the group is not copied.                                                                                   |
| Delete                   | Delete/Backspace; locked objects are kept (with a notice); never while editing text in a field.                                                                                                                       |
| Undo / redo              | Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y. Transactional: one entry per logical operation (a whole drag, an alignment, a property change); up to 200 steps; same-property edits within 1 s coalesce.                              |
| Text                     | Text tool, inline editing on the canvas (Enter / double-click), content, controlled font face, size, line height, letter spacing, alignment, vertical alignment, wrap, overflow mode; overflow indicator.             |
| Shapes                   | Rectangle (corner radius), ellipse, line; fill, stroke colour and width.                                                                                                                                              |
| Images                   | Placed **by asset reference** from the asset picker (PNG, JPEG, sanitized SVG); fit (contain/cover/stretch); effective resolution rating.                                                                             |
| Barcode / QR             | CODE128 and EAN-13 render real vector bars; QR renders real modules from value and error correction. Values are validated centrally (`barcode-core`) and invalid values show a labelled placeholder, never fake bars. |
| Data binding             | Bound properties show a badge on the canvas object and the field names in the properties panel (binding editing and data import are later phases).                                                                    |
| Page settings            | Size, bleed, safe area, margins, display unit. Changing the size **does not scale or move artwork**; the panel says so, and the candidate document must validate before it is applied.                                |

### Placement warnings

`placementWarning` (editor-core) classifies the rotated bounds of the selected object:

| Placement     | Text / barcode / QR                 | Other artwork            |
| ------------- | ----------------------------------- | ------------------------ |
| inside safe   | —                                   | —                        |
| crosses safe  | warning: may be cut or look crowded | —                        |
| into bleed    | warning: will be cut off            | info: extends into bleed |
| beyond bleed  | warning: part will not print        | warning                  |
| outside bleed | warning: not printed at all         | warning                  |

These are provisional editor hints; full preflight is a later phase.

### Effective image resolution

`effective PPI = image pixels ÷ placed size in inches` (the smaller of both axes).

| Rating    | Effective PPI |
| --------- | ------------- |
| `GOOD`    | ≥ 300         |
| `WARNING` | 150 – 299     |
| `LOW`     | < 150         |

SVG images are resolution-independent and are not rated. Thresholds are provisional
(`RESOLUTION_THRESHOLDS`) and will become configurable per customer and process.

## Saving

```text
store.document ─▶ validateDesignDocument ─▶ computeDocumentHash
      │                 │ errors: INVALID "Fix errors to save", issues listed, nothing sent
      │                 ▼
      │           same hash as last save? ─▶ SAVED without a request
      ▼
PATCH /template-versions/:id { document, expectedRevision }
      ├─ 200  ─▶ SAVED, new revision and server hash adopted
      ├─ 409 VERSION_CONFLICT ─▶ CONFLICT dialog, autosave stops
      ├─ 403 FORBIDDEN / 409 VERSION_IMMUTABLE ─▶ FAILED with the reason, editor becomes read-only
      ├─ stored hash ≠ editor hash ─▶ FAILED ("does not match the editor state"), never reported saved
      └─ other ─▶ FAILED, changes kept dirty, explicit save retries
```

- **States** (top bar, announced to assistive technology): `SAVED` "Saved", `UNSAVED` "Unsaved
  changes", `SAVING` "Saving…", `FAILED` "Save failed", `INVALID` "Fix errors to save",
  `CONFLICT` "Changed elsewhere", `READ_ONLY` "Read-only". Ctrl+S saves. Leaving the page with
  unsaved changes asks first.
- **Single flight:** requests never overlap; changes made during a save trigger exactly one
  follow-up save.
- **Conflicts:** "This draft was changed in another session. Reload the latest version before
  saving your changes." The newer server version is never overwritten; **Reload latest version**
  replaces the local document and clears the undo history.
- **Autosave (conservative):** 4 s after the last change and only once no gesture is in progress;
  paused after a conflict (until reload) or a failed save (until an explicit save succeeds); never
  for read-only sessions.
- **Server side:** the API re-validates the document (including tenant asset and font references),
  recomputes the hash, enforces `DRAFT` status and `expectedRevision` atomically and writes
  `TEMPLATE_VERSION_UPDATED` with `revision`, `previousDocumentHash`, `documentHash`,
  `schemaVersion`, `pageCount` and `objectCount` in the same transaction.
- **Schema upgrades:** a schema v1 draft opens migrated; a notice explains that saving stores it as
  schema v2 and that its texts need controlled fonts.

## Permissions and immutability

The UI hides nothing as a security measure; the API decides.

| Situation                                 | Designer UI                                                      | Server                                    |
| ----------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `template-version:edit-draft` + `DRAFT`   | Editable                                                         | Accepts PATCH with current revision       |
| No edit permission (viewer, approver, QA) | "You have view-only access" banner; tools, fields, keys disabled | `403 FORBIDDEN`                           |
| `IN_REVIEW`, `APPROVED`, `ARCHIVED`, …    | "…cannot be edited. Create a new version" banner                 | `409 VERSION_IMMUTABLE` (plus DB trigger) |
| Stale revision                            | Conflict dialog                                                  | `409 VERSION_CONFLICT`                    |

## Preview and compare

- **Preview** renders the active page from the canonical document with rendering-core (scene →
  SVG): no selection, no guides, trimmed piece or print sheet with bleed. It reports text shown
  with substitute fonts ([typography.md](typography.md#missing-fonts-never-silent)).
- **Compare** draws the canonical SVG over the live canvas with the same viewport:
  - `difference` — identical pixels cancel to black, divergence lights up
  - `onion` — 50 % overlay
  - `side-by-side` — canonical SVG next to the canvas

  Because both paths share the layout engine, symbol geometry and image placement, differences
  are limited to rasterization (anti-aliasing) unless something is wrong.

## Shortcuts

The **?** key opens the full list. Main keys: Ctrl+Z / Ctrl+Shift+Z undo/redo, Ctrl+C/V/D,
Ctrl+S, Ctrl+A, Delete, arrows / Shift+arrows nudge, Esc, Ctrl + / − / 0 / 1 zoom, Space + drag or
wheel to pan, Ctrl + wheel to zoom at the pointer, Alt while dragging to bypass snapping, Enter to
edit text, T R E L B Q to add text, rectangle, ellipse, line, barcode, QR.

Zoom range is 10 %–800 % (steps 10, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800 %); at 100 %
a 50 mm tag appears at about 50 mm on a 96-dpi display.

## Accessibility

Toolbar buttons have accessible names and tooltips; the Layers panel is a multi-select listbox
(Enter/Space select, Alt+↑/↓ move, F2 rename) with a screen-reader hint; properties are labelled
form fields that accept exact values; save state is announced through a live status region; dialogs
trap focus and close with Esc. The canvas itself is pointer-driven; every canvas operation also
has a keyboard or panel equivalent.

## Performance

Measured by `e2e/tests/editor-performance.spec.ts` (headless Chromium on the development
workstation, 120 objects of all types, report written to `e2e/test-results/editor-performance.json`).
Ranges cover the Phase 2 verification runs:

| Metric                                | Result        | Budget (asserted) |
| ------------------------------------- | ------------- | ----------------- |
| Editor open (navigation → ready)      | 2.3 – 2.5 s   | < 15 s            |
| Canvas mount                          | 0.10 – 0.16 s | < 3 s             |
| Frame rate while dragging             | 48 – 55 fps   | > 20 fps          |
| Gesture commit (pointer up → UNSAVED) | 0.10 – 0.13 s | < 2 s             |
| Save                                  | 0.23 – 0.43 s | —                 |
| 10 keyboard nudges                    | 0.48 – 0.64 s | —                 |

Before symbol caching, the same test measured 25 fps: every redraw re-encoded all barcodes and QR
codes.

What keeps it fast: one commit per gesture (not per pointer move), identity-diffed canvas sync
(only changed objects are updated), text layouts memoized per object snapshot, encoded symbols
memoized per snapshot and encoder, snap targets computed once per gesture, and React isolated
from pointer events.

## Diagnostics

Setting `localStorage["smarttag:editor-diagnostics"] = "1"` exposes `window.__smarttagEditor`
(`store`, `save`, `canvas`) for support and the browser tests. It grants nothing a same-origin
script could not already do and is off by default.
